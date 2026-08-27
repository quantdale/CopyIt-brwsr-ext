export class Tooltip {
  private el: HTMLElement;
  private hideTimer: number | null = null;
  private showTimer: number | null = null;
  private currentTarget: HTMLElement | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  attach(target: HTMLElement, text: string): void {
    if (!text) return;
    const show = () => {
      if (this.showTimer) clearTimeout(this.showTimer);
      this.showTimer = window.setTimeout(() => this.show(target, text), 250);
    };
    const hide = () => this.hideSoon();
    target.addEventListener("mouseenter", show);
    target.addEventListener("mouseleave", hide);
    target.addEventListener("focus", show);
    target.addEventListener("blur", hide);
    target.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hideImmediately();
    });
  }

  private show(target: HTMLElement, text: string): void {
    if (this.currentTarget && this.currentTarget !== target) {
      this.currentTarget.removeAttribute("aria-describedby");
    }
    this.currentTarget = target;
    this.el.textContent = text;
    this.el.classList.remove("hidden");
    this.el.setAttribute("aria-hidden", "false");
    target.setAttribute("aria-describedby", "tooltip");
    this.position(target);
  }

  private position(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const tipRect = this.el.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + tipRect.width > vw - 8) left = vw - tipRect.width - 8;
    if (left < 8) left = 8;
    if (top + tipRect.height > vh - 8) top = rect.top - tipRect.height - 6;
    if (top < 8) top = 8;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  private hideSoon(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hideImmediately(), 80);
  }

  hideImmediately(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.el.classList.add("hidden");
    this.el.setAttribute("aria-hidden", "true");
    if (this.currentTarget) {
      this.currentTarget.removeAttribute("aria-describedby");
      this.currentTarget = null;
    }
  }

  destroy(): void {
    this.hideImmediately();
  }
}
