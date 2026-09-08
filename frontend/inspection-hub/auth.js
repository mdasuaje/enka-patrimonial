/**
 * Auth Module - Vista Ciega 3-Factores
 * Conecta con Cloud Function /api/auth/vista-ciega (protegida por IAP)
 */

export const authGateway = {
    /**
     * Valida la triada: Teléfono : Apartamento : Nombre
     * Retorna { success: true, documento: { signed_url, expires_in_seconds } }
     * o lanza Error con mensaje
     */
    async validate(telefono, apartamento, nombre_completo) {
        const payload = {
            telefono: telefono.trim(),
            apartamento: apartamento.trim().toUpperCase(),
            nombre_completo: nombre_completo.trim().toUpperCase(),
        };

        const response = await fetch("/api/auth/vista-ciega", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // IAP añade automáticamente Authorization: Bearer <OIDC>
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || data.error || "Credenciales inválidas",
            );
        }

        return data;
    },
};

// Normalización helpers (exportados para uso compartido)
export function normalizePhone(phone) {
    let cleaned = phone.replace(/[\s\-()]/g, "");
    if (!cleaned.startsWith("+")) {
        if (cleaned.startsWith("58")) cleaned = "+" + cleaned;
        else if (cleaned.startsWith("0")) cleaned = "+58" + cleaned.slice(1);
        else cleaned = "+58" + cleaned;
    }
    return cleaned;
}

export function normalizeName(name) {
    return name
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

export function normalizeApt(apt) {
    return apt.toUpperCase().trim();
}
