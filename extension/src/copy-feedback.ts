const DEFAULT_COPY_FEEDBACK_MS = 850;

/** Applies and later resets the transient success state used by copy buttons. */
export function showCopySuccess(
  button: HTMLButtonElement,
  originalText: string,
  onReset: () => void,
  durationMs = DEFAULT_COPY_FEEDBACK_MS,
): number {
  button.textContent = "✓";
  button.classList.add("copied");
  return window.setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove("copied");
    button.disabled = false;
    onReset();
  }, durationMs);
}
