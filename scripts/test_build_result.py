"""Holding threshold tests. All company names, identifiers and dates are synthetic."""
import unittest
import tempfile
from pathlib import Path
from build_result import build, ratio, write_report


def row(n, eid, pct, code="", state="在营"):
    return {"序号": str(n), "企业名称": "测试" + eid, "企业ID": eid,
            "经营状态": state, "统一社会信用代码": code,
            "持股合计": pct, "直接投资": pct, "链接": "https://www.riskbird.com/ent/test.html?entid=" + eid}


def request(a, b):
    return {"root": {"企业名称": "示例集团有限公司", "企业ID": "ROOT", "链接": "https://www.riskbird.com/ent/test.html?entid=ROOT"},
            "collected_at": "2000-01-01", "entity_resolution": {"input_name": "示例集团", "selected_name": "示例集团有限公司"},
            "sources": {k: {"rows": r, "expected_count": len(r), "complete": True, "status_filter": "all", "ratio_filter": "all"} for k, r in [("A", a), ("B", b)]}}


class Tests(unittest.TestCase):
    def test_boundary_and_status(self):
        payload = request([], [row(1, "one", "50%"), row(2, "two", "49.999999999999999999999999%"), row(3, "three", "100%", state="注销")])
        payload["status"] = "在营"
        result = build(payload)
        self.assertEqual([x["企业ID"] for x in result["企业"]], ["one"])
        self.assertTrue(result["校验"]["完整"])

    def test_default_retains_all_statuses_and_blank(self):
        states = ["在营", "注销", "吊销", "撤销", "迁出", "停业", "其他", ""]
        rows = [row(i + 1, str(i), "50%", state=s) for i, s in enumerate(states)]
        rows.append(row(len(rows) + 1, "below_threshold", "49.9999%", state="注销"))
        for a, b in [(rows, []), ([], rows)]:
            result = build(request(a, b))
            self.assertEqual([x["经营状态"] for x in result["企业"]], states + (["注销"] if a else []))
            self.assertTrue(result["校验"]["完整"])

    def test_active_only_old_source_is_not_all_status_complete(self):
        payload = request([row(1, "one", "60%")], [])
        for source_status in ["在营", "unknown"]:
            payload["sources"]["A"]["status_filter"] = source_status
            result = build(payload)
            self.assertEqual(len(result["企业"]), 1)
            self.assertFalse(result["校验"]["完整"])
        payload["status"] = "在营"
        payload["sources"]["A"]["status_filter"] = "在营"
        self.assertTrue(build(payload)["校验"]["完整"])

    def test_missing_proportion_is_unresolved(self):
        result = build(request([], [row(1, "one", "--")]))
        self.assertFalse(result["校验"]["完整"])
        self.assertEqual(len(result["企业"]), 0)
        self.assertIsNone(ratio("0.5"))

    def test_deduplicate_and_preserve_edges(self):
        a, b = row(1, "one", "60%", "CODE"), row(1, "one", "60%")
        result = build(request([a], [b]))
        self.assertEqual(result["校验"]["入选数量"], {"A": 1, "B": 1, "C": 1, "AB交集": 1})
        self.assertEqual(len(result["企业"][0]["数据关联"]), 2)
        self.assertEqual(result["企业"][0]["统一社会信用代码"], "CODE")

    def test_identity_conflict_and_same_name(self):
        a, b = row(1, "one", "60%", "C1"), row(1, "one", "60%", "C2")
        self.assertFalse(build(request([a], [b]))["校验"]["完整"])
        b = row(1, "two", "60%")
        b["企业名称"] = a["企业名称"]
        self.assertEqual(len(build(request([a], [b]))["企业"]), 2)

    def test_partial_and_sequence(self):
        payload = request([row(1, "one", "60%")], [])
        payload["sources"]["A"]["expected_count"] = 2
        self.assertFalse(build(payload)["校验"]["完整"])
        payload = request([row(2, "one", "60%")], [])
        self.assertFalse(build(payload)["校验"]["完整"])

    def test_direct_all_ratios_and_missing_are_retained(self):
        rows = [row(i+1, str(i), pct, state="注销") for i, pct in enumerate(["20%", "0%", "--", "", "49%", "50%"])]
        payload = request(rows, [])
        payload["min_ratio"] = 90
        payload["direct_basis"] = "direct"  # obsolete field cannot reintroduce A filtering
        result = build(payload)
        self.assertEqual(len(result["企业"]), 6)
        self.assertTrue(result["校验"]["完整"])
        self.assertEqual(result["企业"][0]["数据关联"][0]["平台持股合计"], "20%")
        self.assertEqual(result["企业"][0]["数据关联"][0]["筛选比例"], "")

    def test_old_filtered_direct_source_is_partial(self):
        payload = request([row(1, "one", "80%")], [])
        for old in ["gte", "unknown"]:
            payload["sources"]["A"]["ratio_filter"] = old
            payload["sources"]["A"]["min_ratio"] = 50
            result = build(payload)
            self.assertEqual(len(result["企业"]), 1)
            self.assertFalse(result["校验"]["完整"])

    def test_indirect_source_must_cover_requested_threshold(self):
        payload = request([], [row(1, "one", "80%")])
        source = payload["sources"]["B"]
        source["ratio_filter"] = "gte"
        for floor, complete in [(50, True), (40, True), (60, False), ("NaN", False), (None, False)]:
            source["min_ratio"] = floor
            self.assertEqual(build(payload)["校验"]["完整"], complete)

    def test_report_does_not_label_direct_investment_as_control(self):
        result = build(request([row(1, "one", "1%")], [row(1, "two", "50%")]))
        with tempfile.TemporaryDirectory() as temp:
            write_report(result, Path(temp))
            for name in ["查询结果.html", "查询说明.md"]:
                text = (Path(temp) / name).read_text(encoding="utf-8")
                self.assertIn("直接投资：1", text)
                self.assertNotIn("直接控股", text)
                self.assertIn("间接控股：1", text)

    def test_alias_mismatch(self):
        payload = request([], [])
        payload["entity_resolution"]["selected_name"] = "另一个实体"
        with self.assertRaises(ValueError):
            build(payload)


if __name__ == "__main__":
    unittest.main()
