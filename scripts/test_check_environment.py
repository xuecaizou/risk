"""Verify that readiness checks do not enumerate tabs or accept remote endpoints."""
import io
import unittest
from unittest.mock import patch
from check_environment import check_cdp


class Tests(unittest.TestCase):
    def test_only_requested_version_endpoint(self):
        with patch("check_environment.build_opener") as factory:
            factory.return_value.open.return_value = io.BytesIO(
                b'{"Browser":"Chrome/test","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/synthetic"}')
            self.assertTrue(check_cdp("http://127.0.0.1:9222"))
            req = factory.return_value.open.call_args.args[0]
            self.assertEqual(req.full_url, "http://127.0.0.1:9222/json/version")
            self.assertEqual(factory.return_value.open.call_count, 1)

    def test_reject_external_and_credential_urls_without_request(self):
        for endpoint in ["http://example.invalid:9222", "http://127.0.0.1:9222/json/list", "http://user:pass@127.0.0.1:9222"]:
            with patch("check_environment.build_opener") as factory:
                with self.assertRaises(ValueError):
                    check_cdp(endpoint)
                factory.assert_not_called()

    def test_other_http_service_is_not_cdp(self):
        with patch("check_environment.build_opener") as factory:
            factory.return_value.open.return_value = io.BytesIO(b'{"service":"example"}')
            self.assertFalse(check_cdp("http://localhost:9222"))


if __name__ == "__main__":
    unittest.main()
