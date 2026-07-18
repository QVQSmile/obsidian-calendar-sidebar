import CalendarSidebarPlugin from './plugin';

declare const module: { exports: unknown };

// Obsidian loads main.js as a CommonJS plugin class.
module.exports = CalendarSidebarPlugin;
