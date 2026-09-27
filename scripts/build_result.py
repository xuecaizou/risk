"""Offline validation and report generation. Python standard library only."""
import argparse
import html
import json
import re
from decimal import Decimal
from pathlib import Path


def ratio(value):
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*[%％]\s*", str(value))
    if not match:
        return None
    number = Decimal(match[1])
    return number if 0 <= number <= 100 else None


def build(payload):
    root = payload["root"]
    if not root.get("企业名称") or not root.get("企业ID") or not root.get("链接"):
        raise ValueError("root需企业名称、企业ID和实际详情链接")
    date = payload.get("collected_at")
    if not date:
        raise ValueError("collected_at必填")
    resolution = payload.get("entity_resolution", {})
    if resolution.get("selected_name", root["企业名称"]) != root["企业名称"]:
        raise ValueError("简称匹配结果与查询主体不一致")
    threshold = Decimal(str(payload.get("min_ratio", 50)))
    if not threshold.is_finite() or not 0 <= threshold <= 100:
        raise ValueError("min_ratio须在0至100之间")
    status = payload.get("status", "all")
    if status not in ("在营", "all"):
        raise ValueError("status不支持")
    issues, excluded, accepted = [], [], {"A": [], "B": []}
    coverage = {}
    all_rows = [r for key in ("A", "B") for r in payload["sources"][key]["rows"]]
    id_to_code, conflicts = {}, set()
    for r in all_rows:
        eid, code = r.get("企业ID", ""), r.get("统一社会信用代码", "")
        if eid and code:
            if eid in id_to_code and id_to_code[eid] != code:
                conflicts.add(eid)
            id_to_code[eid] = code
    if conflicts:
        issues.append({"类型": "同一企业ID对应冲突信用代码", "企业ID": sorted(conflicts)})

    def identity(row):
        eid, code = row.get("企业ID", ""), row.get("统一社会信用代码", "")
        code = code or id_to_code.get(eid, "")
        return "code:" + code if code else "id:" + eid if eid else ""

    merged = {}
    for key in ("A", "B"):
        source = payload["sources"][key]
        rows, expected = source["rows"], source.get("expected_count")
        sequence = [str(r.get("序号", "")) for r in rows]
        count_ok = isinstance(expected, int) and not isinstance(expected, bool) and expected >= 0 and len(rows) == expected
        sequence_ok = sequence == [str(i + 1) for i in range(len(rows))]
        keys = [identity(r) for r in rows]
        unique_ok = len(keys) == len(set(keys))
        source_status = source.get("status_filter", "unknown")
        status_coverage = source_status == "all" or (status == "在营" and source_status == "在营")
        source_ratio = source.get("ratio_filter", "unknown")
        ratio_coverage = source_ratio == "all"
        if key == "B" and source_ratio == "gte":
            try:
                floor = Decimal(str(source.get("min_ratio")))
                ratio_coverage = floor.is_finite() and 0 <= floor <= threshold
            except (ValueError, ArithmeticError):
                ratio_coverage = False
        source_ok = bool(source.get("complete") is True and count_ok and sequence_ok and unique_ok and status_coverage and ratio_coverage)
        coverage[key] = {"页面预期": expected, "已读取": len(rows), "序号连续": sequence_ok,
                         "来源内无重复": unique_ok, "完整": source_ok, "页面筛选": source.get("page_filters", ""),
                         "原始状态筛选": source_status, "状态范围覆盖": status_coverage,
                         "原始比例筛选": source_ratio, "比例范围覆盖": ratio_coverage,
                         "接口路径": source.get("endpoint", ""), "采集方式": source.get("transport", "")}
        for row in rows:
            selected_field = "不设持股阈值" if key == "A" else "持股合计"
            number = ratio(row.get(selected_field, ""))
            ident = identity(row)
            reason = None
            invalid = False
            if not row.get("企业名称") or not ident or row.get("企业ID") in conflicts:
                reason, invalid = "企业身份缺失或冲突", True
            elif row.get("企业ID") == root["企业ID"] or (root.get("统一社会信用代码") and row.get("统一社会信用代码") == root["统一社会信用代码"]):
                reason = "根公司单列"
            elif key == "B" and number is None:
                reason, invalid = "比例未知或格式无效", True
            elif key == "B" and number < threshold:
                reason = "低于持股阈值"
            elif status != "all" and row.get("经营状态") != status:
                reason = "不符合经营状态"
                invalid = not bool(row.get("经营状态"))
            if reason:
                excluded.append({"来源": key, "企业名称": row.get("企业名称", ""), "序号": row.get("序号", ""), "原因": reason})
                if invalid:
                    issues.append(excluded[-1])
                continue
            relation = {"查询主体": root["企业名称"], "查询主体ID": root["企业ID"],
                        "关系类型": "直接投资" if key == "A" else "间接投资", "来源名单": key,
                        "筛选依据": selected_field, "筛选比例": "" if key == "A" else str(number) + "%",
                        "直接投资比例": row.get("直接投资", ""), "平台持股合计": row.get("持股合计", ""),
                        "来源链接": root["链接"], "来源序号": row.get("序号", ""),
                        "查询时间": date, "中间股权链": row.get("中间股权链", "")}
            if ident not in merged:
                node = {field: row.get(field, "") for field in ("企业名称", "经营状态", "统一社会信用代码", "企业ID", "地区", "行业", "注册资本", "成立日期")}
                node.update({"统一社会信用代码": row.get("统一社会信用代码") or id_to_code.get(row.get("企业ID"), ""),
                             "PID": root["企业ID"], "企业详情链接": row.get("链接", ""), "数据关联": []})
                merged[ident] = node
            elif merged[ident]["企业名称"] != row["企业名称"] or merged[ident]["经营状态"] != row.get("经营状态", ""):
                issues.append({"类型": "同一身份字段冲突", "企业名称": row["企业名称"]})
            merged[ident]["数据关联"].append(relation)
            accepted[key].append(ident)
    companies = list(merged.values())
    counts = {key: len(set(ids)) for key, ids in accepted.items()}
    counts.update({"C": len(companies), "AB交集": len(set(accepted["A"]) & set(accepted["B"]))})
    check = {"完整": all(x["完整"] for x in coverage.values()) and not issues,
             "来源覆盖": coverage, "入选数量": counts, "排除记录": excluded, "待核查": issues,
             "信用代码留空": sum(not c["统一社会信用代码"] for c in companies)}
    return {"查询主体": root, "名称匹配": resolution, "查询时间": date,
            "口径": {"直接投资": "全部保留，不设持股阈值", "间接投资最小持股比例": str(threshold) + "%", "状态": status,
                     "PID含义": "查询起点企业ID，不代表间接企业的直接股东", "递归": False, "新增付费": 0},
            "校验": check, "证据": payload.get("evidence", []),
            "名单A": [merged[x] for x in dict.fromkeys(accepted["A"])],
            "名单B": [merged[x] for x in dict.fromkeys(accepted["B"])], "企业": companies}


def write_report(result, directory):
    directory.mkdir(parents=True, exist_ok=True)
    dump = lambda name, value: (directory / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    dump("名单C.json", result)
    dump("校验结果.json", result["校验"])
    esc = html.escape
    root, rule, check = result["查询主体"], result["口径"], result["校验"]
    counts = check["入选数量"]
    complete = "采集与校验完整" if check["完整"] else "部分结果／存在待核查项，不可视为完整名单"
    statement = (f"用户输入：{result['名称匹配'].get('input_name', root['企业名称'])}；实际企业：{root['企业名称']}；时间：{result['查询时间']}。\n"
                 f"直接投资：不设持股阈值；间接控股：持股合计≥{rule['间接投资最小持股比例']}；状态：{'全部经营状态' if rule['状态'] == 'all' else rule['状态']}。\n"
                 f"直接投资：{counts['A']}；间接控股：{counts['B']}；交集：{counts['AB交集']}；合并后：{counts['C']}。\n"
                 f"状态：{complete}。信用代码留空：{check['信用代码留空']}家。\n")
    instructions = ("\n直接投资保留平台该列表的全部企业；间接投资采用根公司视角的风鸟持股合计筛选，不逐家递归扩大关联网络。50%包含边界，不直接等同法律上的独家控制；合并后名单包含参股企业。\n"
                    "PID表示本次查询起点，间接投资不表示直接股东。数据关联保存直接/间接、比例、来源和时间；未展开路径留空。\n"
                    "免费注册可能获得VIP（用户提供的提示），实际权限以当前账号和页面为准。本次新增付费为0，不含用户既有会员费用。\n"
                    "平台数据可能有更新延迟或覆盖限制；完整性仅针对本次页面及校验。排除原因和待核查项见校验结果.json。\n"
                    "通用步骤：确认主体→直接投资全量读取→间接投资比例筛选→逐页保存→去重并保留关系→校验计数与边界→交付。\n")
    (directory / "查询说明.md").write_text("# 查询说明\n\n" + statement + instructions, encoding="utf-8")
    data = json.dumps(result["企业"], ensure_ascii=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    page = r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>__TITLE__ · 投资关联企业名单</title>
<style>body{font:15px system-ui,sans-serif;color:#203047;background:#f3f6fa;margin:28px}header,section{background:white;padding:22px;border-radius:12px;margin-bottom:16px}h1{font-size:27px}p{line-height:1.8}input,select{padding:10px;margin:4px;border:1px solid #bac7d8;border-radius:6px}input{width:310px}a{color:#155ea9}.scroll{overflow:auto;max-height:70vh}table{border-collapse:collapse;background:white;width:100%;font-size:13px}td,th{padding:12px;border-bottom:1px solid #e1e8f0;vertical-align:top;text-align:left;min-width:100px}th{position:sticky;top:0;background:#e9eff8}td:first-child{min-width:300px}td:last-child{min-width:320px}.note{color:#59697e}</style>
<header><h1>__TITLE__ · 投资关联企业名单</h1><p>__STATEMENT__</p><p class="note">以查询主体为起点，直接投资不设持股阈值，间接投资按阈值筛选，不递归扩张。PID为查询起点，间接关系不表示直接股东。缺失信用代码及未展开路径留空。</p><a href="名单C.json" download>完整JSON</a> · <a href="查询说明.md">查询说明</a> · <a href="校验结果.json">校验明细</a></header>
<section><input id="q" placeholder="搜索企业、地区、行业"><select id="kind"><option value="">全部关系</option><option value="直接投资">直接投资</option><option value="间接投资">间接控股</option></select><select id="status"><option value="">全部状态</option></select><span id="count"></span></section>
<div class="scroll"><table><thead><tr><th>企业名称</th><th>经营状态</th><th>统一社会信用代码</th><th>PID</th><th>企业ID</th><th>地区</th><th>行业</th><th>数据关联</th></tr></thead><tbody id="rows"></tbody></table></div>
<script>const data=__DATA__;const q=document.querySelector('#q'),kind=document.querySelector('#kind'),state=document.querySelector('#status');for(const s of new Set(data.map(x=>x.经营状态))){const o=document.createElement('option');o.textContent=s;state.appendChild(o)}function cell(tr,value){const td=document.createElement('td');td.textContent=value||'';tr.appendChild(td);return td}function render(){const records=data.filter(x=>(!q.value||[x.企业名称,x.地区,x.行业].join(' ').includes(q.value))&&(!kind.value||x.数据关联.some(r=>r.关系类型===kind.value))&&(!state.value||x.经营状态===state.value));document.querySelector('#count').textContent='显示 '+records.length+' 家';const body=document.querySelector('#rows');body.replaceChildren();for(const x of records){const tr=document.createElement('tr');const first=cell(tr,x.企业名称);try{const u=new URL(x.企业详情链接);if(u.protocol==='https:'&&u.hostname==='www.riskbird.com'){const a=document.createElement('a');a.href=u.href;a.textContent=x.企业名称;a.target='_blank';a.rel='noopener';first.replaceChildren(a)}}catch{}for(const k of ['经营状态','统一社会信用代码','PID','企业ID','地区','行业'])cell(tr,x[k]);cell(tr,x.数据关联.map(r=>r.查询主体+' → '+r.关系类型+' → '+x.企业名称+'；'+r.筛选依据+' '+r.筛选比例).join('\n'));body.appendChild(tr)}}q.oninput=render;kind.onchange=render;state.onchange=render;render();</script></html>'''
    page = page.replace("__TITLE__", esc(root["企业名称"])).replace("__STATEMENT__", esc(statement).replace("\n", "<br>"))
    # Insert data last: company values must not be interpreted as template tokens.
    page = page.replace("__DATA__", data)
    (directory / "查询结果.html").write_text(page, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = build(json.loads(args.input.read_text(encoding="utf-8-sig")))
    write_report(result, args.out)
    counts = result["校验"]["入选数量"]
    print(json.dumps({"完整": result["校验"]["完整"], "直接投资": counts["A"], "间接控股": counts["B"], "交集": counts["AB交集"], "合并后": counts["C"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
