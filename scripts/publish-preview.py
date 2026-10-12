#!/usr/bin/env python3
"""Publish the checked-in branch to /preview/ without changing the live homepage."""
import json
import re
import subprocess

REPO = 'telekineticbot/website'

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def api(path, data=None):
    command = ['gh', 'api', f'repos/{REPO}/{path}']
    if data is not None:
        command += ['--method', 'POST', '--input', '-']
    result = subprocess.run(command, input=json.dumps(data) if data is not None else None,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)

revision = git('rev-parse', 'HEAD')
# Requires the review branch to have been pushed, not merged.
api(f'git/commits/{revision}')
html = subprocess.check_output(['git', 'show', f'{revision}:index.html'], text=True)
html = re.sub(r'<!-- Google Tag Manager(?: \(noscript\))? -->.*?<!-- End Google Tag Manager(?: \(noscript\))? -->', '', html, flags=re.S)
html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">')
html = html.replace('<title>', '<title>Preview — ', 1)
# Use the reviewed assets rather than production tracking code.
html = html.replace('src="/assets/', 'src="assets/')
# Exercise the controls without adding test addresses to the live mailing list.
html = html.replace('    errorEl.textContent = "";\n    submitBtn.disabled = true;',
                    '    errorEl.textContent = "Preview only — no email was submitted.";\n    return;\n    submitBtn.disabled = true;')
index_blob = api('git/blobs', {'content': html, 'encoding': 'utf-8'})['sha']
assets_tree = git('rev-parse', f'{revision}:assets')
preview_tree = api('git/trees', {'tree': [
    {'path': 'index.html', 'mode': '100644', 'type': 'blob', 'sha': index_blob},
    {'path': 'assets', 'mode': '040000', 'type': 'tree', 'sha': assets_tree},
]})['sha']
main = api('git/ref/heads/main')['object']['sha']
main_tree = api(f'git/commits/{main}')['tree']['sha']
root = api(f'git/trees/{main_tree}')['tree']
live_index = next(entry['sha'] for entry in root if entry['path'] == 'index.html')
new_tree = api('git/trees', {'base_tree': main_tree, 'tree': [
    {'path': 'preview', 'mode': '040000', 'type': 'tree', 'sha': preview_tree}
]})['sha']
new_root = api(f'git/trees/{new_tree}')['tree']
assert next(entry['sha'] for entry in new_root if entry['path'] == 'index.html') == live_index
commit = api('git/commits', {'message': f'Publish isolated review preview for {revision[:12]}',
                           'tree': new_tree, 'parents': [main]})['sha']
# Non-forced update fails safely if main advanced concurrently.
subprocess.run(['gh', 'api', '--method', 'PATCH', f'repos/{REPO}/git/refs/heads/main',
                '--input', '-'], input=json.dumps({'sha': commit, 'force': False}),
               text=True, check=True, stdout=subprocess.DEVNULL)
print(f'Preview revision: {revision}')
print(f'Pages deployment commit: {commit}')
print('Live homepage unchanged (verified identical Git blob).')
print('After the GitHub Pages deployment completes: https://telekinetic.bot/preview/')
