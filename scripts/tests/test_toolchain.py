"""Exercise discovery, failure propagation and staged formatting in Git fixtures."""

import json
import os
import runpy
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_spacing as spacing
import install_hooks as hooks

ROOT = Path(__file__).resolve().parents[2]
SCANNER = Path(spacing.__file__).resolve()


class ToolchainTests(unittest.TestCase):
    """Keep each test's Git state and working files isolated."""

    def setUp(self):
        """Create an independently owned temporary Git repository."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")

    def git(self, *args, check=True):
        """Run Git only in the fixture repository."""
        return subprocess.run(
            ["git", *args],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=check,
        )

    def scan(self, *args):
        """Run the real scanner against the fixture working tree."""
        return subprocess.run(
            [sys.executable, str(SCANNER), "--root", str(self.root), *args],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_discovery_hidden_untracked_ignored_symlinks_and_deleted(self):
        """Include hidden inputs and exclude dependencies and archives."""
        (self.root / ".gitignore").write_text("node_modules/\n")
        for name in (".hidden.py", "space name.yml", "deleted.py", "README.md"):
            (self.root / name).write_text("# valid\n")
        self.git("add", ".")
        (self.root / "deleted.py").unlink()
        (self.root / "new.py").write_text("# valid\n")
        binary = self.root / "bin"
        binary.mkdir()
        (binary / "entry").write_text("#!/usr/bin/env python3\n")
        (self.root / "linked.py").symlink_to(self.root / ".hidden.py")
        for directory in ("node_modules", ".agents/notes/archived"):
            target = self.root / directory
            target.mkdir(parents=True)
            (target / "ignored.py").write_text("# valid\n")
        selected = spacing.selected_paths(self.root, [])
        self.assertEqual(
            set(selected),
            {".hidden.py", "space name.yml", "README.md", "new.py", "bin/entry"},
        )

    def test_empty_missing_and_code_fix_fail(self):
        """Neither empty scans nor an explicit code rewrite may report success."""
        self.assertNotEqual(self.scan().returncode, 0)
        self.assertNotEqual(self.scan("missing.py").returncode, 0)
        code = self.root / "source.py"
        code.write_text("# valid\n")
        self.assertNotEqual(self.scan("--fix", "source.py").returncode, 0)
        self.assertEqual(code.read_text(), "# valid\n")

    def test_yaml_scanner_and_empty_repository(self):
        """Reject real wide comments, preserving multiline literal contents."""
        checker = ROOT / "scripts/check-yaml-comments.py"
        empty = subprocess.run(
            [sys.executable, str(checker)],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(empty.returncode, 0)
        path = self.root / ".hidden 中文.yaml"
        check = runpy.run_path(str(checker))["check"]
        for source, accepted in (
            ("# " + "中" * 39 + "\nkey: value\n", True),
            ("# " + "中" * 40 + "\nkey: value\n", False),
            ("text: |\n  # " + "中" * 50 + "\n", True),
            ('text: "line\n  # ' + "中" * 50 + '"\n', True),
        ):
            path.write_text(source)
            self.assertEqual(not check(path), accepted)

    def test_markdown_pipeline_failure(self):
        """A successful downstream formatter must not hide upstream failure."""
        result = subprocess.run(
            [
                "bash",
                "-c",
                (
                    "autocorrect() { return 7; }; export -f autocorrect; "
                    "bash scripts/fmt-markdown.sh README.md"
                ),
            ],
            cwd=ROOT,
            input="# Test\n",
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 7)

    def test_preview_links_preserve_customizations_and_support_source_override(self):
        """Build real soft/hard links and refuse an owned configuration file."""
        scripts = self.root / "scripts"
        scripts.mkdir()
        script = scripts / "crossnote-links.sh"
        shutil.copyfile(ROOT / "scripts/crossnote-links.sh", script)
        source = self.root / "preview-source"
        # Hard-link behavior requires a source on the fixture filesystem.
        shutil.copytree(ROOT / "assets/.crossnote", source)
        environment = {**os.environ, "CROSSNOTE_SRC": str(source)}
        command = ["bash", str(script)]
        for _ in range(2):
            result = subprocess.run(
                command, env=environment, capture_output=True, check=False
            )
            self.assertEqual(result.returncode, 0, result.stderr)
        for name in (
            "parser.js",
            "style.less",
            "config.js",
            "head.html",
            "README.md",
            "scripts",
            "tests",
            "vendor",
        ):
            link = self.root / ".crossnote" / name
            self.assertTrue(link.is_symlink())
            self.assertTrue(link.samefile(source / name))
        for name in ("pseudocode-runtime.js", "theme-toggle.js"):
            link = self.root / ".crossnote" / name
            self.assertFalse(link.is_symlink())
            self.assertTrue(link.samefile(source / name))
        custom = self.root / ".crossnote/parser.js"
        custom.unlink()
        custom.write_text("// user configuration\n")
        rejected = subprocess.run(
            command, env=environment, capture_output=True, check=False
        )
        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual(custom.read_text(), "// user configuration\n")
        environment["CROSSNOTE_SRC"] = str(self.root / "missing")
        missing = subprocess.run(
            command, env=environment, capture_output=True, check=False
        )
        self.assertNotEqual(missing.returncode, 0)

    def test_shell_failure_is_not_hidden_by_a_later_valid_file(self):
        """Hidden shell inputs are checked and the first failure remains nonzero."""
        checker = ROOT / "scripts/check_shell.py"
        command = [sys.executable, str(checker)]
        empty = subprocess.run(command, cwd=self.root, capture_output=True, check=False)
        self.assertNotEqual(empty.returncode, 0)
        bad = self.root / ".hidden.sh"
        good = self.root / "valid.sh"
        good.write_text('#!/bin/bash\necho "valid"\n')
        bad.write_text('#!/bin/bash\necho "$undefined_fixture"\n')
        result = subprocess.run(
            command, cwd=self.root, capture_output=True, check=False
        )
        self.assertNotEqual(result.returncode, 0)
        bad.write_text('#!/bin/bash\necho "valid"\n')
        self.assertEqual(
            subprocess.run(
                command, cwd=self.root, capture_output=True, check=False
            ).returncode,
            0,
        )

    def test_real_text_diagnostics_fail_and_fix_is_markdown_only(self):
        """CLI lint reports code violations while --fix leaves code untouched."""
        bad = "# " + "\u4e2d\u6587Python\n"
        code = self.root / ".hidden.py"
        code.write_text(bad)
        (self.root / "README.md").write_text("# " + "\u4e2d\u6587Markdown\n")
        result = self.scan()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".hidden.py", result.stdout)
        self.assertEqual(self.scan("--fix").returncode, 0)
        self.assertEqual(code.read_text(), bad)
        code.write_text("# " + "\u4e2d\u6587 Python\n")
        self.assertEqual(self.scan().returncode, 0)

    def test_earlier_batch_failure_survives_later_success(self):
        """A successful final batch cannot conceal an earlier failed process."""
        for number in range(101):
            (self.root / f"file-{number:03}.py").write_text("# valid\n")
        selected = spacing.selected_paths(self.root, [])
        with (
            patch.object(sys, "argv", ["check-spacing", "--root", str(self.root)]),
            patch.object(spacing.subprocess, "run") as run,
            patch.object(spacing, "selected_paths", return_value=selected),
        ):
            run.side_effect = [
                subprocess.CompletedProcess([], 9),
                subprocess.CompletedProcess([], 0),
            ]
            self.assertEqual(spacing.main(), 1)
            self.assertEqual(run.call_count, 2)
            self.assertIn("--strict", run.call_args.args[0])
            self.assertNotIn("--format", run.call_args.args[0])

    def test_extensionless_and_command_files_are_actually_linted(self):
        """Select a grammar rather than silently skip unknown names."""
        for name, shebang in (("command", "python3"), ("entry.command", "zsh")):
            path = self.root / name
            path.write_text(
                "#!/usr/bin/env " + shebang + "\n# " + "\u4e2d\u6587Python\n"
            )
            result = self.scan(name)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_install_refuses_foreign_hook_and_custom_hook_directory(self):
        """Installation preserves a user's hooks and explicitly rejects hooksPath."""
        hook = self.root / ".git/hooks/pre-commit"
        hook.write_text("#!/bin/sh\n# user hook\n")
        with self.assertRaisesRegex(SystemExit, "foreign hook"):
            hooks.install(self.root)
        self.assertEqual(hook.read_text(), "#!/bin/sh\n# user hook\n")
        self.git("config", "core.hooksPath", ".hooks")
        with self.assertRaisesRegex(SystemExit, "core.hooksPath"):
            hooks.install(self.root)

    def test_commit_and_push_use_installed_environment_without_activation(self):
        """Prefer installed Python over PATH and keep failing push checks blocking."""
        config = {
            "repos": [
                {
                    "repo": "local",
                    "hooks": [
                        {
                            "id": "environment",
                            "name": "environment",
                            "language": "system",
                            "entry": "python3 -c "
                            + shlex.quote(
                                "import identify, markdown_it; "
                                "from pathlib import Path; "
                                "raise SystemExit(int(Path('reject-push').exists()))"
                            ),
                            "stages": ["pre-commit", "pre-push"],
                            "always_run": True,
                            "pass_filenames": False,
                        }
                    ],
                }
            ]
        }
        (self.root / ".pre-commit-config.yaml").write_text(json.dumps(config))
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        poison = self.root / "poison-bin"
        poison.mkdir()
        python = poison / "python3"
        python.write_text("#!/bin/sh\nexit 42\n")
        python.chmod(0o755)
        environment = {
            **os.environ,
            "PATH": f"{poison}{os.pathsep}{os.environ['PATH']}",
        }
        hooks.install(self.root)
        hooks.install(self.root, "pre-push")
        hooks.install(self.root, "pre-push")
        (self.root / "source.py").write_text("value = 1\n")
        self.git("add", "source.py")
        committed = subprocess.run(
            ["git", "commit", "-qm", "without activation"],
            cwd=self.root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(committed.returncode, 0, committed.stdout + committed.stderr)
        remote = self.root / "remote.git"
        self.git("init", "--bare", "-q", str(remote))
        command = ["git", "push", str(remote), "HEAD:refs/heads/main"]
        pushed = subprocess.run(
            command, cwd=self.root, env=environment, capture_output=True, check=False
        )
        self.assertEqual(pushed.returncode, 0, pushed.stdout + pushed.stderr)
        self.git("commit", "--allow-empty", "-qm", "next push")
        (self.root / "reject-push").touch()
        rejected = subprocess.run(
            command, cwd=self.root, env=environment, capture_output=True, check=False
        )
        self.assertNotEqual(rejected.returncode, 0)
        local_head = self.git("rev-parse", "HEAD").stdout.strip()
        remote_head = self.git("ls-remote", str(remote), "refs/heads/main").stdout
        self.assertNotIn(local_head, remote_head)
        push_hook = self.root / ".git/hooks/pre-push"
        push_hook.write_text("#!/bin/sh\n# user hook\n")
        with self.assertRaisesRegex(SystemExit, "foreign hook"):
            hooks.install(self.root, "pre-push")
        self.assertEqual(push_hook.read_text(), "#!/bin/sh\n# user hook\n")

    def test_fresh_repository_adopts_language_recipes(self):
        """Use the published format hooks in a new repository with real tools."""
        config = yaml.safe_load((ROOT / ".pre-commit-config.yaml").read_text())
        wanted = {
            "prose-format",
            "config-format",
            "python-format",
            "toml-format",
            "shell-format",
            "python-lint",
            "spacing",
            "shell-lint",
            "yaml-comments",
            "actions",
        }
        local = config["repos"][0]
        local["hooks"] = [hook for hook in local["hooks"] if hook["id"] in wanted]
        config["repos"] = [local]
        (self.root / ".pre-commit-config.yaml").write_text(yaml.safe_dump(config))
        for name in (
            ".autocorrectrc",
            ".autocorrectignore",
            ".prettierrc.json",
            "ruff.toml",
        ):
            shutil.copyfile(ROOT / name, self.root / name)
        shutil.copytree(
            ROOT / "scripts",
            self.root / "scripts",
            ignore=shutil.ignore_patterns("__pycache__", "tests"),
        )
        (self.root / "node_modules").symlink_to(
            ROOT / "node_modules", target_is_directory=True
        )
        (self.root / ".gitignore").write_text("node_modules/\n__pycache__/\n")
        files = {
            "source.py": '"""Fixture module."""\nvalue=1\n',
            "run.sh": '#!/bin/bash\necho "valid"\n',
            "config.toml": "[fixture]\nvalue=1\n",
            ".hidden.jsonc": '{"value":1}\n',
            "config.yaml": "value: [one,two]\n",
            "README.md": "# Fixture\n\nValid prose.\n",
            ".github/workflows/ci.yml": (
                "name: Fixture\non: push\njobs:\n  test:\n"
                "    runs-on: ubuntu-latest\n    steps:\n      - run: echo valid\n"
            ),
        }
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        hooks.install(self.root)
        for name, source in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(source)
        self.git("add", ".")
        committed = self.git("commit", "-qm", "adopt recipes", check=False)
        self.assertEqual(committed.returncode, 0, committed.stdout + committed.stderr)
        self.assertIn("value = 1", self.git("show", "HEAD:source.py").stdout)
        self.assertIn("value = 1", self.git("show", "HEAD:config.toml").stdout)
        self.assertEqual(self.scan().returncode, 0)
        workflow = self.root / ".github/workflows/ci.yml"
        workflow.write_text(
            workflow.read_text().replace("ubuntu-latest", "invalid-runner")
        )
        self.git("add", ".github/workflows/ci.yml")
        rejected = self.git("commit", "-qm", "invalid workflow", check=False)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("actions", rejected.stdout + rejected.stderr)

    def test_real_commit_preserves_partial_staging_and_rejects_staged_error(self):
        """Actual pre-commit hides unstaged fixes and preserves unstaged additions."""
        gfs = ROOT / "node_modules/.bin/git-format-staged"
        ruff = shutil.which("ruff")
        self.assertIsNotNone(ruff)
        config = {
            "repos": [
                {
                    "repo": "local",
                    "hooks": [
                        {
                            "id": "format",
                            "stages": ["manual"],
                            "name": "format",
                            "language": "system",
                            "entry": (
                                f"{gfs} --formatter "
                                f'"{ruff} format --stdin-filename {{}} -"'
                            ),
                            "types": ["python"],
                        },
                        {
                            "id": "spacing",
                            "stages": ["pre-commit"],
                            "name": "spacing",
                            "language": "system",
                            "entry": f"{sys.executable} {SCANNER}",
                            "pass_filenames": False,
                            "always_run": True,
                        },
                    ],
                }
            ],
        }
        (self.root / ".pre-commit-config.yaml").write_text(json.dumps(config))
        code = self.root / "source.py"
        code.write_text("value = 0\n")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        hooks.install(self.root)
        hooks.install(self.root)
        code.write_text("value=1\n")
        self.git("add", "source.py")
        code.write_text("value=1\n\n# unstaged addition\n")
        committed = self.git("commit", "-qm", "formatted", check=False)
        self.assertEqual(committed.returncode, 0, committed.stdout + committed.stderr)
        self.assertEqual(self.git("show", "HEAD:source.py").stdout, "value = 1\n")
        self.assertIn("# unstaged addition", code.read_text())
        bad = "# " + "\u4e2d\u6587Python\n"
        code.write_text("value = 2\n" + bad)
        self.git("add", "source.py")
        fixed = "value = 2\n# " + "\u4e2d\u6587 Python\n"
        code.write_text(fixed)
        rejected = self.git("commit", "-qm", "must fail", check=False)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual(code.read_text(), fixed)
        self.assertIn(bad, self.git("show", ":source.py").stdout)
        invalid = "value = (\n"
        code.write_text(invalid)
        self.git("add", "source.py")
        failed_format = self.git("commit", "-qm", "invalid syntax", check=False)
        self.assertNotEqual(failed_format.returncode, 0)
        self.assertEqual(code.read_text(), invalid)
        self.assertEqual(self.git("show", ":source.py").stdout, invalid)

    def test_format_conflict_is_reported_without_losing_worktree(self):
        """A formatter merge conflict reports a warning and retains the user's edit."""
        gfs = ROOT / "node_modules/.bin/git-format-staged"
        code = self.root / "source.py"
        code.write_text("value = 0\n")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        code.write_text("value=1\n")
        self.git("add", "source.py")
        code.write_text("value=2\n")
        result = subprocess.run(
            [str(gfs), "--formatter", "ruff format --stdin-filename {} -", "source.py"],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertIn("warning", (result.stdout + result.stderr).lower())
        self.assertEqual(code.read_text(), "value=2\n")
        self.assertEqual(self.git("show", ":source.py").stdout, "value = 1\n")


if __name__ == "__main__":
    unittest.main()
