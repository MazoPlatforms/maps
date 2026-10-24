import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/check-review.py"
SPEC = importlib.util.spec_from_file_location("check_review", SCRIPT)
check_review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_review)


def review(login, state, commit="head"):
    return {"user": {"login": login}, "state": state, "commit_id": commit}


class ReviewPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = {
            "users": ["solo", "maintainer-2"],
            "ordinaryApprovals": 1,
            "boundaryApprovals": 2,
            "soloMaintainerMode": True,
        }
        self.pr = {"user": {"login": "contributor"}, "head": {"sha": "head"}}

    def test_accepts_only_exact_head_non_author_approval(self):
        result = check_review.review_decision(
            self.policy,
            self.pr,
            [[review("solo", "APPROVED", "old"), review("maintainer-2", "APPROVED")]],
        )
        self.assertEqual(result["reviewers"], ["maintainer-2"])

    def test_latest_dismissal_replaces_prior_approval(self):
        with self.assertRaisesRegex(ValueError, "Review required"):
            check_review.review_decision(
                self.policy,
                self.pr,
                [[review("solo", "APPROVED"), review("solo", "DISMISSED")]],
            )

    def test_latest_comment_replaces_prior_approval(self):
        with self.assertRaisesRegex(ValueError, "Review required"):
            check_review.review_decision(
                self.policy,
                self.pr,
                [[review("solo", "APPROVED"), review("solo", "COMMENTED")]],
            )

    def test_boundary_requires_two_non_author_maintainers(self):
        with self.assertRaisesRegex(ValueError, "2 configured"):
            check_review.review_decision(
                self.policy, self.pr, [[review("solo", "APPROVED")]], boundary=True
            )

    def test_solo_mode_is_explicit_and_only_for_sole_author(self):
        policy = {**self.policy, "users": ["solo"]}
        pr = {**self.pr, "user": {"login": "solo"}}
        result = check_review.review_decision(policy, pr, [])
        self.assertEqual(result["mode"], "solo-maintainer")
        with self.assertRaisesRegex(ValueError, "Review required"):
            check_review.review_decision(policy, self.pr, [])

    def test_solo_mode_never_waives_boundary_review(self):
        policy = {**self.policy, "users": ["solo"]}
        pr = {**self.pr, "user": {"login": "solo"}}
        with self.assertRaisesRegex(ValueError, "2 configured"):
            check_review.review_decision(policy, pr, [], boundary=True)


if __name__ == "__main__":
    unittest.main()
