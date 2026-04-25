export function findDiscordComposerAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[role="textbox"]') ??
    document.querySelector<HTMLElement>("[data-list-item-id]")
  );
}

export function isDiscordDirectMessageRoute(): boolean {
  return /^\/channels\/@me\/\d+$/.test(window.location.pathname);
}
