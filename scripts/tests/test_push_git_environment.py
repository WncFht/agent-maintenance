"""Run a real linked-worktree push whose gate creates a second Git repository."""

import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import install_hooks  # noqa: E402


def exercise_push_isolation(tmp_path):
    assertions = unittest.TestCase()

    def git(folder, *args, env=None, check=True):
        return subprocess.run(
            ["git", "-C", str(folder), *args],
            env=env,
            check=check,
            capture_output=True,
            text=True,
        )

    repository = tmp_path / "repository"
    repository.mkdir()
    git(repository, "init", "-q")
    git(repository, "config", "user.name", "Fixture")
    git(repository, "config", "user.email", "fixture@example.invalid")
    scripts = repository / "scripts"
    scripts.mkdir()
    for name in ("install_hooks.py",):
        shutil.copy2(ROOT / "scripts" / name, scripts / name)
    (scripts / "probe.py").write_text(
        "import os, subprocess, tempfile\n"
        "from pathlib import Path\n"
        "with tempfile.TemporaryDirectory() as folder:\n"
        "    subprocess.run(['git', 'init', '--bare', '-q', folder], check=True)\n"
        "    command = ['git', '-C', folder, 'rev-parse', '--absolute-git-dir']\n"
        "    found = subprocess.check_output(command, text=True).strip()\n"
        "    assert Path(found) == Path(folder).resolve(), found\n"
        "raise SystemExit(9 if os.environ.get('FAIL_PUSH_PROBE') else 0)\n"
    )
    config = {
        "repos": [
            {
                "repo": "local",
                "hooks": [
                    {
                        "id": "nested-git",
                        "name": "nested Git isolation",
                        "language": "system",
                        "entry": shlex.quote(sys.executable) + " scripts/probe.py",
                        "stages": ["pre-push"],
                        "always_run": True,
                        "pass_filenames": False,
                    }
                ],
            }
        ]
    }
    (repository / ".pre-commit-config.yaml").write_text(yaml.safe_dump(config))
    install_hooks.install(repository, "pre-push")
    git(repository, "add", ".")
    git(repository, "commit", "-qm", "fixture")
    worktree = tmp_path / "worktree"
    git(repository, "worktree", "add", "-qb", "push-check", str(worktree))
    remote = tmp_path / "remote.git"
    git(repository, "init", "--bare", "-q", str(remote))
    before = git(worktree, "rev-parse", "HEAD").stdout.strip()
    pushed = git(worktree, "push", str(remote), "HEAD:refs/heads/result", check=False)
    assertions.assertEqual(pushed.returncode, 0, pushed.stdout + pushed.stderr)
    assertions.assertEqual(git(worktree, "rev-parse", "HEAD").stdout.strip(), before)
    assertions.assertEqual(
        git(repository, "config", "core.bare").stdout.strip(), "false"
    )
    assertions.assertEqual(
        git(repository, "config", "user.name").stdout.strip(), "Fixture"
    )
    assertions.assertFalse(git(worktree, "status", "--porcelain").stdout)
    (worktree / "next.txt").write_text("next\n")
    git(worktree, "add", "next.txt")
    git(worktree, "commit", "-qm", "next")
    failed = git(
        worktree,
        "push",
        str(remote),
        "HEAD:refs/heads/result",
        env={**os.environ, "FAIL_PUSH_PROBE": "1"},
        check=False,
    )
    assertions.assertNotEqual(failed.returncode, 0)
    assertions.assertEqual(
        git(remote, "rev-parse", "refs/heads/result").stdout.strip(), before
    )


class PushEnvironmentTests(unittest.TestCase):
    def test_nested_git_and_failed_push(self):
        with tempfile.TemporaryDirectory() as directory:
            exercise_push_isolation(Path(directory))
