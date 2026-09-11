# Tab Sync browser extensions

This directory contains the chrome, firefox, safari extensions that report open tabs and browser history to a Tab Sync server. The server URL can be configured in Settings.

## Chrome

Chrome uses the Manifest V3 extension rooted at this directory.

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `extensions/` directory, the one containing `manifest.json`.
4. Pin **Tab Sync**, then click its toolbar icon. It opens the extension dashboard in a browser tab.
5. In **Settings**, use the local server if necessary, then create an account or sign in.

Use the Reload button on `chrome://extensions` after changing extension source files.

## Firefox

Firefox 142 or newer can run the same Manifest V3 source as a temporary add-on.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select this directory's `manifest.json`.
4. Open Tab Sync from the toolbar, set the server to localhost if needed, and sign in.

## Safari on iPhone

The iOS Safari extension is the Xcode project at `safari/Tab Sync/Tab Sync.xcodeproj`. On a Mac with Xcode:

1. Open that project in Xcode and select a development team for its app and extension targets.
2. Connect an iPhone, select it as the run destination, and run the **Tab Sync** app.
3. On the iPhone, open Safari, use the Page Menu beside the address bar, choose **Manage Extensions**, and enable **Tab Sync**.
4. Grant the requested website access, then open Tab Sync from the Page Menu and sign in.

The Safari web-extension source shared by the Xcode project is in the `shared/` directory. Building for device installation requires an appropriate Apple development signing setup.
