# Interactive review

Review changes at https://telekinetic.bot/preview/ before merging the application PR.
The preview supports real scrolling, resizing, animations, and form focus. Analytics
are disabled, and submitting a valid email displays a preview message without
contacting the mailing-list service. The page is marked noindex.

To update it, commit and push the review branch, then run:

```sh
python scripts/publish-preview.py
```

This publishes that commit's HTML and assets under `/preview/` on GitHub Pages.
It makes a preview-only commit on main while preserving the production homepage
and its assets byte for byte. It does not merge the review branch. Wait for the
Pages deployment to finish and verify the preview URL before sharing it.

After approval, merge the application PR separately. Never treat preview approval
or publishing as approval to change the live homepage.
