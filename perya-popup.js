/* =========================================================
   PERYA CUSTOM POPUP SYSTEM
========================================================= */

(() => {
    let activeResolver = null;
    let previousFocus = null;

    function elements() {
        return {
            overlay: document.getElementById("peryaPopupOverlay"),
            icon: document.getElementById("peryaPopupIcon"),
            title: document.getElementById("peryaPopupTitle"),
            message: document.getElementById("peryaPopupMessage"),
            input: document.getElementById("peryaPopupInput"),
            cancelButton: document.getElementById("peryaPopupCancelButton"),
            confirmButton: document.getElementById("peryaPopupConfirmButton")
        };
    }

    function closePopup(result) {
        const popup = elements();

        if (!popup.overlay || popup.overlay.hidden) return;

        popup.overlay.hidden = true;
        document.body.classList.remove("peryaPopupOpen");

        const resolver = activeResolver;
        activeResolver = null;

        previousFocus?.focus?.();
        previousFocus = null;

        resolver?.(result);
    }

    function openPopup({
        type = "info",
        title = "Notice",
        message = "",
        mode = "message",
        defaultValue = "",
        placeholder = "",
        confirmText = "OK",
        cancelText = "Cancel"
    } = {}) {
        const popup = elements();

        if (
            !popup.overlay ||
            !popup.icon ||
            !popup.title ||
            !popup.message ||
            !popup.input ||
            !popup.cancelButton ||
            !popup.confirmButton
        ) {
            console.error("PERYA popup HTML is missing.");
            return Promise.resolve(mode === "choice" ? false : null);
        }

        if (activeResolver) closePopup(null);

        const icons = {
            success: "✅",
            error: "❌",
            warning: "⚠️",
            info: "ℹ️",
            choice: "❓",
            input: "✏️"
        };

        previousFocus = document.activeElement;

        popup.overlay.dataset.type = type;
        popup.icon.textContent = icons[type] || icons.info;
        popup.title.textContent = title;
        popup.message.textContent = String(message || "");

        popup.input.hidden = mode !== "input";
        popup.input.value = String(defaultValue || "");
        popup.input.placeholder = placeholder;

        popup.cancelButton.hidden = mode === "message";
        popup.cancelButton.textContent = cancelText;
        popup.confirmButton.textContent = confirmText;

        popup.overlay.hidden = false;
        document.body.classList.add("peryaPopupOpen");

        setTimeout(() => {
            if (mode === "input") {
                popup.input.focus();
                popup.input.select();
            } else {
                popup.confirmButton.focus();
            }
        }, 0);

        return new Promise(resolve => {
            activeResolver = resolve;

            popup.confirmButton.onclick = () => {
                closePopup(mode === "input" ? popup.input.value : true);
            };

            popup.cancelButton.onclick = () => {
                closePopup(mode === "choice" ? false : null);
            };

            popup.overlay.onclick = event => {
                if (event.target === popup.overlay && mode !== "message") {
                    closePopup(mode === "choice" ? false : null);
                }
            };
        });
    }

    window.showPeryaAlert = (message, options = {}) => {
        const type = options.type || "info";
        const titles = {
            success: "Success",
            error: "Error",
            warning: "Warning",
            info: "Notice"
        };

        return openPopup({
            type,
            title: options.title || titles[type] || "Notice",
            message,
            mode: "message",
            confirmText: options.buttonText || "OK"
        });
    };

    window.showPeryaConfirm = (message, options = {}) => {
        return openPopup({
            type: "choice",
            title: options.title || "Please Confirm",
            message,
            mode: "choice",
            confirmText: options.confirmText || "Confirm",
            cancelText: options.cancelText || "Cancel"
        });
    };

    window.showPeryaPrompt = (message, options = {}) => {
        return openPopup({
            type: "input",
            title: options.title || "Enter Information",
            message,
            mode: "input",
            defaultValue: options.defaultValue || "",
            placeholder: options.placeholder || "",
            confirmText: options.confirmText || "Submit",
            cancelText: options.cancelText || "Cancel"
        });
    };

    document.addEventListener("keydown", event => {
        const popup = elements();

        if (!popup.overlay || popup.overlay.hidden) return;

        if (event.key === "Escape") {
            event.preventDefault();
            closePopup(popup.cancelButton.hidden ? true : null);
        }

        if (
            event.key === "Enter" &&
            document.activeElement === popup.input &&
            !popup.input.hidden
        ) {
            event.preventDefault();
            popup.confirmButton.click();
        }
    });
})();
