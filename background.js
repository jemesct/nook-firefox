'use strict';

/* global browser, chrome */
const B = typeof browser !== 'undefined' ? browser : chrome;

// Toolbar button toggles the sidebar.
B.action.onClicked.addListener(() => {
  B.sidebarAction.toggle().catch(() => {});
});
