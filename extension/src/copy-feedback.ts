const DEFAULT_COPY_FEEDBACK_MS = 850;

/** Applies and later resets the transient success state used by copy buttons. */
export function showCopySuccess(
  button: HTMLButtonElement,
  originalText: string,
  onReset: () => void,
  durationMs = DEFAULT_COPY_FEEDBACK_MS,
): number {
  const originalLabel = button.getAttribute("aria-label");
  button.textContent = "✓";
  button.setAttribute("aria-label", "Copied");
  button.classList.add("copied");
  return window.setTimeout(() => {
    button.textContent = originalText;
    if (originalLabel === null) button.removeAttribute("aria-label");
    else button.setAttribute("aria-label", originalLabel);
    button.classList.remove("copied");
    button.disabled = false;
    onReset();
  }, durationMs);
}
