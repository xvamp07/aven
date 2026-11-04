# FitLog, Phase 0 (foundation)

A personal nutrition and gym tracker that runs on your iPhone as an installed web app.
Your data stays on the phone. Phase 0 only proves the foundation: install, offline, storage,
backup, restore and safe updates. The Nutrition and Gym screens come in the next phases.

## 1. Publish it (free, about 10 minutes)

GitHub's menus change from time to time. If a step looks different, tell me what you see.

1. Create a free account at github.com.
2. Create a new repository. The repository name becomes part of the app's permanent web address,
   so choose it carefully and never rename it later. Set it to **Public** (required for free GitHub Pages).
   Do not add a README. Only code is public. Your data never leaves your phone.
3. Unzip this folder on your PC. In the new repository choose **uploading an existing file**
   (or Add file, then Upload files). Drag the CONTENTS of the unzipped folder into the page:
   index.html, sw.js, version.js, manifest.webmanifest, styles.css and the folders js and icons.
   Then press **Commit changes**.
4. Go to **Settings, Pages**. Under Build and deployment choose **Deploy from a branch**,
   branch **main**, folder **/ (root)**, then Save. After one or two minutes the page shows your address:
   `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`
5. On the iPhone, open that address in **Safari itself** (not inside another app). Tap Share,
   then **Add to Home Screen**. Open FitLog from its new icon.

The name "FitLog" is read when you add the icon. To change it, edit it in index.html and manifest.webmanifest
before your real install. Changing it later means removing the icon, which also removes its data.

## 2. The iPhone checklist (please do every item)

A. Open FitLog from the icon and wait. The top should say **Ready for offline use**.
   If not, tap **Copy all results** at the bottom and paste them into the chat.
B. Add a test note. Swipe FitLog away, reopen it. The note must still be there and "Times opened" must go up.
C. Switch on airplane mode, swipe FitLog away, open it from the icon. It must open with the note.
D. Backup test: add a note, tap **Create backup**, then **Save to Files**. Check the file is in Files.
   Delete the note, then **Choose backup file** and restore. The note must come back. Repeat with
   **Copy as text** and **Paste backup text instead**. Also try **Undo last restore**.
E. Update test: on GitHub open version.js, tap the pencil, change 0.1.0 to 0.1.1, commit.
   Wait one or two minutes, open FitLog online, tap **Check for updates**. A banner says Update ready.
   Tap **Apply update**. The version changes and the note is still there.
F. Look: status bar text readable in light and dark mode, the title not under the notch, the bottom tabs clear of the home bar.
G. Throwaway tests (test data only): delete the Home Screen icon and reinstall: is the note gone?
   Optionally clear Safari website data in iOS Settings: does the installed app keep its note?
H. Soak test: leave FitLog unopened for 8 days or more, then open it in airplane mode.
   Do not enter real data until this passes.

## 3. The one rule for updates

Whenever you change ANY file, also change the number in version.js. Phones only notice an update
when that number changes. If you forget, they keep the old files.
If you add a new file to the project, also add it to the ASSETS list in sw.js.
