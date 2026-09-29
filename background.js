// Toolbar button: show the panel on the IRCTC tab. Shortcut: handle the booking page that's open.
// The panel's "Edit passengers" link asks for the options page, which content scripts can't open themselves.
function send(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // No content script: not an IRCTC page, or the tab was open before the extension loaded.
    chrome.action.setBadgeText({ tabId, text: '!' });
    chrome.action.setTitle({ tabId, title: 'Open www.irctc.co.in, or reload the IRCTC tab after installing the extension' });
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-passengers') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) send(tab.id, { type: 'fill' });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) send(tab.id, { type: 'panel' });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'options') chrome.runtime.openOptionsPage();
});
