type ModalOptions = {
  title: string;
  message?: string;
  bodyHtml?: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  inputPlaceholder?: string;
  initialValue?: string;
};

type ModalResult = { confirmed: boolean; value: string };

const modalEl = () => document.querySelector("#app-modal") as HTMLDivElement;
const titleEl = () => document.querySelector("#app-modal-title") as HTMLHeadingElement;
const bodyEl = () => document.querySelector("#app-modal-body") as HTMLDivElement;
const inputEl = () => document.querySelector("#app-modal-input") as HTMLInputElement;
const cancelBtn = () => document.querySelector("#app-modal-cancel") as HTMLButtonElement;
const confirmBtn = () => document.querySelector("#app-modal-confirm") as HTMLButtonElement;

let resolver: ((result: ModalResult) => void) | null = null;

const closeModal = (result: ModalResult) => {
  modalEl().classList.add("hidden");
  resolver?.(result);
  resolver = null;
};

export const initModalHandlers = () => {
  cancelBtn().addEventListener("click", () => closeModal({ confirmed: false, value: inputEl().value }));
  confirmBtn().addEventListener("click", () => closeModal({ confirmed: true, value: inputEl().value }));
  modalEl().addEventListener("click", (event) => {
    if (event.target === modalEl()) closeModal({ confirmed: false, value: inputEl().value });
  });
};

export const showModal = (options: ModalOptions) => {
  titleEl().textContent = options.title;
  bodyEl().innerHTML = options.bodyHtml ?? (options.message ? `<p>${options.message}</p>` : "");
  confirmBtn().textContent = options.confirmText ?? "OK";
  cancelBtn().textContent = options.cancelText ?? "Cancel";
  cancelBtn().classList.toggle("hidden", !options.showCancel);
  inputEl().classList.toggle("hidden", !options.inputPlaceholder);
  inputEl().placeholder = options.inputPlaceholder ?? "";
  inputEl().value = options.initialValue ?? "";
  modalEl().classList.remove("hidden");
  if (options.inputPlaceholder) inputEl().focus();
  else confirmBtn().focus();

  return new Promise<ModalResult>((resolve) => {
    resolver = resolve;
  });
};

export const showInfoDialog = async (title: string, message: string) => {
  await showModal({ title, message, confirmText: "OK" });
};

export const showConfirmDialog = async (title: string, message: string, confirmText = "OK", cancelText = "Cancel") => {
  const result = await showModal({ title, message, confirmText, cancelText, showCancel: true });
  return result.confirmed;
};

export const showPromptDialog = async (title: string, message: string, placeholder: string, initialValue = "") => {
  const result = await showModal({
    title,
    message,
    inputPlaceholder: placeholder,
    initialValue,
    confirmText: "Join",
    cancelText: "Cancel",
    showCancel: true,
  });
  return result.confirmed ? result.value : null;
};

