"""Read-only review gate. Execute the trusted base version in Actions, never a PR override."""

import argparse
import json
import subprocess


def review_decision(policy, pr, review_pages, boundary=False):
    """Return an explicit approval mode; never count author or stale approvals."""
    latest = {}
    for page in review_pages:
        for review in page:
            login = review["user"]["login"]
            if login in policy["users"] and review["state"] in {
                "APPROVED",
                "CHANGES_REQUESTED",
                "DISMISSED",
                "COMMENTED",
            }:
                latest[login] = review
    valid = [
        login
        for login, review in latest.items()
        if review["state"] == "APPROVED"
        and review["commit_id"] == pr["head"]["sha"]
        and login != pr["user"]["login"]
    ]
    required = policy["boundaryApprovals"] if boundary else policy["ordinaryApprovals"]
    if len(valid) >= required:
        return {"mode": "approved", "reviewers": valid, "required": required}

    # A one-maintainer repository cannot produce an independent approval of
    # its maintainer's own PR. Make that limitation explicit and rely on the
    # required CI checks. Never apply this exception to boundary changes or to
    # contributions from any other author.
    users = policy["users"]
    if (
        not boundary
        and policy.get("soloMaintainerMode") is True
        and len(users) == 1
        and pr["user"]["login"] == users[0]
    ):
        return {"mode": "solo-maintainer", "reviewers": [], "required": required}

    raise ValueError(
        f"Review required: {len(valid)}/{required} configured non-author maintainers "
        f"approved the exact head. Boundary proposals need a second eligible "
        f"maintainer; current policy has {len(users)}."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--number", type=int, required=True)
    parser.add_argument("--base-ref", required=True)
    parser.add_argument("--boundary", action="store_true")
    args = parser.parse_args()
    policy = json.loads(
        subprocess.check_output(
            ["git", "show", args.base_ref + ":.github/maintainers.json"], text=True
        )
    )
    pr = json.loads(
        subprocess.check_output(
            ["gh", "api", f"repos/{args.repository}/pulls/{args.number}"], text=True
        )
    )
    reviews = json.loads(
        subprocess.check_output(
            [
                "gh",
                "api",
                "--paginate",
                "--slurp",
                f"repos/{args.repository}/pulls/{args.number}/reviews?per_page=100",
            ],
            text=True,
        )
    )
    try:
        decision = review_decision(policy, pr, reviews, args.boundary)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    if decision["mode"] == "solo-maintainer":
        print(
            "SOLO-MAINTAINER MODE: no independent approval exists or is claimed; "
            "the sole configured maintainer authored this ordinary PR. Merge "
            "requires all configured validation checks to pass."
        )
        return
    print("Approved by configured maintainers at exact PR head: " + ", ".join(decision["reviewers"]))


if __name__ == "__main__":
    main()
