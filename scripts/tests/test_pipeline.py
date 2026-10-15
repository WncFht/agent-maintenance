"""验证链接发现、暂存快照和可信历史保护的真实行为。"""

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from check_archive import check as check_archive  # noqa: E402
from check_docs import SKILLS, check  # noqa: E402


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        for name in SKILLS:
            skill = self.root / ".agents/skills" / name
            (skill / "agents").mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: 测试\n---\n\n# 技能\n"
            )
            (skill / "agents/openai.yaml").write_text(
                "interface:\n  display_name: 测试\n  short_description: 测试说明\n"
            )
        (self.root / ".agents/notes").mkdir()
        (self.root / ".agents/notes/README.md").write_text("# 记录入口\n")

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.root), *args],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    def test_links_references_images_hidden_and_code(self):
        page = self.root / "README.md"
        page.write_text(
            "# 测试\n\n[说明][ref]\n\n[ref]: .agents/target.md\n\n"
            "![图片](asset.png)\n\n```text\n[非链接](not-a-file.md)\n```\n"
        )
        (self.root / ".agents/target.md").write_text("# 目标\n")
        (self.root / "asset.png").write_bytes(b"fixture")
        self.assertEqual(check(self.root), [])
        (self.root / ".agents/target.md").unlink()
        self.assertTrue(any("target.md" in error for error in check(self.root)))
        page.write_text("# 测试\n\n[越界](../outside.md)\n")
        self.assertTrue(any("越出" in error for error in check(self.root)))

    def test_frozen_links_ignored_and_extra_skill_rejected(self):
        archived = self.root / ".agents/notes/archived/process"
        archived.mkdir(parents=True)
        (archived / "2026-10-15-old.md").write_text("# 旧记录\n\n[旧路径](gone.md)\n")
        self.assertEqual(check(self.root), [])
        extra = self.root / ".agents/skills/extra"
        extra.mkdir()
        (extra / "SKILL.md").write_text("# 额外技能\n")
        self.assertTrue(check(self.root))

    def test_staged_broken_link_not_hidden_by_unstaged_fix(self):
        destination = self.root / "scripts"
        destination.mkdir()
        for name in (
            "check_docs.py",
            "notes_guard.py",
            "check_archive.py",
            "staged_checks.py",
        ):
            shutil.copy2(SCRIPTS / name, destination / name)
        page = self.root / "README.md"
        page.write_text("# 基线\n")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        page.write_text("# 测试\n\n[断链](missing.md)\n")
        self.git("add", "README.md")
        page.write_text("# 未暂存修复\n")
        result = subprocess.run(
            [sys.executable, str(destination / "staged_checks.py")],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing.md", result.stdout)
        self.assertEqual(page.read_text(), "# 未暂存修复\n")
        self.git("add", "README.md")
        result = subprocess.run(
            [sys.executable, str(destination / "staged_checks.py")],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_baseline_rejects_body_and_hash_rewrite(self):
        relative = "archived/process/2026-10-15-fixture.md"
        note = self.root / ".agents/notes" / relative
        note.parent.mkdir(parents=True)
        note.write_text("冻结字节\n")
        manifest = self.root / ".agents/notes/archive-seals.json"
        manifest.write_text(
            json.dumps(
                {
                    "version": 1,
                    "files": {relative: hashlib.sha256(note.read_bytes()).hexdigest()},
                }
            )
        )
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        base = self.git("rev-parse", "HEAD")
        self.assertEqual(check_archive(self.root, self.root, base), [])
        note.write_text("重写正文\n")
        manifest.write_text(
            json.dumps(
                {
                    "version": 1,
                    "files": {relative: hashlib.sha256(note.read_bytes()).hexdigest()},
                }
            )
        )
        self.assertTrue(check_archive(self.root, self.root, base))


if __name__ == "__main__":
    unittest.main()
