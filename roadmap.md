# Roadmap
- [x] Coding bot dashboard (live code surface, terminal, timer: set hours or unlimited, random/strategic)
- [x] AI engines: Ollama offline on CPU (user has no NVIDIA card, small model default) + NVIDIA NIM online option
- [x] Schedules to launch apps/commands
- [x] Running apps list, IDE linking (VS Code etc.)
- [x] Start with Windows + Start Menu shortcut (pin to Start)
- [x] Windows desktop package (zip) in Files
- [x] Setup helper: check Ollama/Python/Node/Git/RAM, one-click installs (winget), one-click model download, recommended model
- [x] Keep PC awake during sessions
- [x] Real project mode: plan file, multi-file, reads own code, partial edits, tests, 3-strike stuck guard, Git commits/rollback, resumes across sessions, project types
- [x] Stuck guard for strategic mode
- [x] Live typing inside VS Code (add-on + one-click install)
- [x] Proper Windows installer (icon, Start Menu + Desktop shortcuts, uninstaller)
- [x] Wire new features into the screen (Project style + plan view, setup checklist, live typing switch)
- [x] Focus view: hide everything except the coding screen
- [x] Theme switch: light theme, white code background, blue/red code colors (syntax colors)
- [x] Real keyboard typing: types code with real keystrokes into the editor in front (counts as PC activity), screen kept on during sessions
- [x] Rebuild Windows download + installer into Files
- [x] Self-updating desktop app (download new version from the published site, restart, no installer)
- [x] During-session "activity apps": every 30/40/custom minutes open a chosen light app, then close it
- [x] VS Code mode that works end to end: auto-open workspace, auto-install add-on, live typing + terminal mirrored in VS Code
- [x] Rebuild installer (last manual install) + update feed
- [x] On open: offer "optimize for this PC" and set everything up automatically (model, editor, project type, folder, installs)
- [x] Remember previous sessions (history list + continue a session cut off by closing the app)
- [x] Never blocked: if the AI or tools are missing, keep writing varied practice code on screen (not saved, no repeats)
- [x] Start Coding asks for typing speed (human, fast typist, quick, as fast as possible, custom)
- [x] "Keep files" switch: off = test in the terminal, then throw the code away
- [x] Validate the finished session flow and create the new Windows installer/update feed

Windows-only installation, real keystrokes, and local AI downloads still need a Windows PC check; the sandbox verifies the shared UI, rules, and release artifacts. Publish the site to serve the 1.3.0 in-app update.
