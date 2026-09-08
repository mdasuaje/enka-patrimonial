/**
 * ENKA Inspection Hub - PWA Frontend (Vanilla JS)
 * Zero-Copy, Zero-Trust, Zero-Billing
 */

(() => {
    // ============================================================
    // STATE & CONFIG
    // ============================================================
    const API_BASE = "http://localhost:3001";
    const LOOKER_BASE_URL = "https://lookerstudio.google.com/embed/reporting";

    // DOM Elements
    const tabs = document.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".panel");
    const authForm = document.getElementById("authForm");
    const phoneInput = document.getElementById("phone");
    const aptoSelect = document.getElementById("apto");
    const nameInput = document.getElementById("name");
    const submitBtn = document.getElementById("submitBtn");
    const btnText = submitBtn.querySelector(".btn-text");
    const btnLoading = submitBtn.querySelector(".btn-loading");
    const errorMsg = document.getElementById("errorMsg");
    const loadingEl = document.getElementById("loading");
    const resultArea = document.getElementById("resultArea");
    const lookerIframe = document.getElementById("lookerIframe");
    const logoutBtn = document.getElementById("logoutBtn");
    const offlineBanner = document.getElementById("offlineBanner");

    // ============================================================
    // UTILS
    // ============================================================
    const showError = (msg) => {
        errorMsg.textContent = msg;
        errorMsg.classList.add("visible");
    };

    const hideError = () => {
        errorMsg.classList.remove("visible");
    };

    const setLoading = (isLoading) => {
        loadingEl.classList.toggle("visible", isLoading);
        submitBtn.disabled = isLoading;
        btnText.style.display = isLoading ? "none" : "inline";
        btnLoading.style.display = isLoading ? "inline" : "none";
    };

    const showResult = (_lookerUrl, aptoId, nombre) => {
        // Build Looker URL with parameters
        const params = new URLSearchParams({
            params: JSON.stringify({ apto_id: aptoId, nombre: nombre }),
        });
        const embedUrl = `${LOOKER_BASE_URL}/XYZ/page/ABC?${params.toString()}`;

        lookerIframe.src = embedUrl;
        resultArea.hidden = false;
        resultArea.classList.add("visible");
        authForm.hidden = true;
    };

    const resetForm = () => {
        authForm.reset();
        hideError();
        resultArea.hidden = true;
        resultArea.classList.remove("visible");
        authForm.hidden = false;
        lookerIframe.src = "";
    };

    const showOffline = (isOffline) => {
        offlineBanner.classList.toggle("visible", isOffline);
    };

    // ============================================================
    // TAB NAVIGATION
    // ============================================================
    for (const btn of tabs) {
        btn.addEventListener("click", () => {
            for (const b of tabs) {
                b.classList.remove("active");
                b.setAttribute("aria-selected", "false");
            }
            for (const p of panels) {
                p.hidden = true;
                p.classList.remove("active");
            }

            btn.classList.add("active");
            btn.setAttribute("aria-selected", "true");

            const panelId = `panel-${btn.dataset.tab}`;
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.hidden = false;
                requestAnimationFrame(() => panel.classList.add("active"));
            }
        });
    }

    // ============================================================
    // PHONE INPUT FORMATTING
    // ============================================================
    phoneInput.addEventListener("input", (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.startsWith("58")) value = value.slice(2);
        if (value.startsWith("0")) value = value.slice(1);

        let formatted = "+58 ";
        if (value.length > 0) formatted += `${value.slice(0, 3)}`;
        if (value.length > 3) formatted += ` ${value.slice(3, 6)}`;
        if (value.length > 6) formatted += ` ${value.slice(6, 10)}`;

        e.target.value = formatted.slice(0, 18);
    });

    // ============================================================
    // AUTH SUBMISSION
    // ============================================================
    authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        const phone = phoneInput.value.trim();
        const apto = aptoSelect.value;
        const name = nameInput.value.trim();

        // Client-side validation
        if (!phone || !apto || !name) {
            showError("Complete todos los campos obligatorios");
            return;
        }

        // Phone format validation
        const phoneRegex = /^\+58\s\d{3}\s\d{3}\s\d{4}$/;
        if (!phoneRegex.test(phoneInput.value)) {
            showError("Formato de teléfono inválido. Use: +58 4XX XXX XXXX");
            phoneInput.focus();
            return;
        }

        setLoading(true);

        try {
            const payload = {
                telefono: phone,
                apartamento: apto,
                nombre_completo: name,
            };

            const response = await fetch(`${API_BASE}/api/auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message || data.error || "Credenciales inválidas",
                );
            }

            // Success - show Looker iframe
            showResult(
                data.looker_url,
                aptoSelect.value,
                nameInput.value.trim(),
            );
        } catch (err) {
            console.error("Auth error:", err);
            showError(err.message);
        } finally {
            setLoading(false);
        }
    });

    // ============================================================
    // LOGOUT
    // ============================================================
    logoutBtn.addEventListener("click", () => {
        resetForm();
    });

    // ============================================================
    // OFFLINE DETECTION
    // ============================================================
    const updateOnlineStatus = () => {
        showOffline(!navigator.onLine);
    };
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    updateOnlineStatus();

    // ============================================================
    // INIT
    // ============================================================
    console.log("[ENKA Hub] PWA initialized - Zero-Copy mode");
})();
