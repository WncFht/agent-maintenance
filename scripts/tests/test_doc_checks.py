"""Exercise real documentation failures, including staged-style isolated roots."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from doc_checks import check_budgets, check_link, markdown_anchors  # noqa: E402


class DocumentChecksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.page = self.root / "README.md"
        self.page.write_text(
            "# 入口\n\n## 中文 `API` 与 **配置**\n\n## 同名\n\n## 同名\n"
        )

    # These literal anchors test renderer output, not natural-language spacing.
    def test_chinese_formatted_heading_duplicate_and_encoded_fragment(self):
        for anchor in (
            "\u4e2d\u6587-api-\u4e0e-\u914d\u7f6e",
            "同名",
            "\u540c\u540d-1",
            "%E5%90%8C%E5%90%8D",
        ):
            self.assertIsNone(check_link(self.root, self.page, "#" + anchor, {}))
        self.assertIn("锚点", check_link(self.root, self.page, "#\u540c\u540d-2", {}))

    def test_heading_collision_and_explicit_html(self):
        text = '# A\n# A-1\n# A\n<a id="fixed"></a>\n<a name="legacy"></a>\n'
        self.assertEqual(markdown_anchors(text), {"a", "a-1", "a-2", "fixed", "legacy"})
        self.assertNotIn("fake", markdown_anchors('```html\n<a id="fake"></a>\n```\n'))

    def test_directory_fragments_assets_and_escape(self):
        folder = self.root / "guide"
        folder.mkdir()
        (folder / "README.md").write_text("# Usage\n")
        self.assertIsNone(check_link(self.root, self.page, "guide/#usage", {}))
        self.assertIsNotNone(check_link(self.root, self.page, "guide/#absent", {}))
        (self.root / "image.svg").write_text("<svg/>")
        self.assertIsNone(check_link(self.root, self.page, "image.svg#view", {}))
        self.assertIsNotNone(check_link(self.root, self.page, "../outside.md", {}))
        self.assertIsNone(
            check_link(self.root, self.page, "https://example.invalid/#x", {})
        )

    def policy(self, hard, soft=None):
        (self.root / "scripts").mkdir(exist_ok=True)
        (self.root / "scripts/doc-policy.json").write_text(
            json.dumps({"version": 1, "hard_limits": hard, "soft_limits": soft or []})
        )

    def test_budget_failure_warning_missing_and_invalid_limits(self):
        self.policy({"README.md": 1})
        self.assertTrue(check_budgets(self.root, [self.page])[0])
        self.policy({}, [{"glob": "*.md", "characters": 1}])
        errors, warnings = check_budgets(self.root, [self.page])
        self.assertFalse(errors)
        self.assertTrue(warnings)
        for hard in (
            {"missing.md": 99},
            {"README.md": True},
            {"README.md": 0},
            {"../out.md": 2},
        ):
            self.policy(hard)
            self.assertTrue(check_budgets(self.root, [self.page])[0])

    def test_real_checker_rejects_bad_fragment_and_hard_budget(self):
        for name in ("maintain-docs", "maintain-prose", "maintain-decision-notes"):
            folder = self.root / ".agents/skills" / name
            (folder / "agents").mkdir(parents=True)
            (folder / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: fixture\n---\n"
            )
            (folder / "agents/openai.yaml").write_text(
                "interface:\n  display_name: fixture\n  short_description: fixture\n"
            )

        def run():
            return subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "check_docs.py"),
                    "--root",
                    str(self.root),
                ],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(run().returncode, 0)
        self.page.write_text('# Intro\n\n<a href="#missing">bad</a>\n')
        result = run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("锚点", result.stdout)
        self.page.write_text("# Intro\n\n[valid](#intro)\n")
        self.policy({"README.md": 1})
        self.assertNotEqual(run().returncode, 0)
        self.policy({}, [{"glob": "*.md", "characters": 1}])
        result = run()
        self.assertEqual(result.returncode, 0)
        self.assertIn("提示", result.stdout)


if __name__ == "__main__":
    unittest.main()
