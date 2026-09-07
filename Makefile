.PHONY: build serve verify status

build:
	@echo "[+] Compilando expediente digital en evidencia/index.html..."
	@python3 -c "import json; c1=open('specs/carta_alcaldia.md').read(); c2=open('specs/dossier_tecnico.md').read(); c3=open('tasks/checklist_expediente.md').read(); open('evidencia/index.html','w').write(f'<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Expediente ENKA</title><style>body{{font-family:sans-serif;line-height:1.6;margin:40px;max-width:900px;color:#222;}}table{{border-collapse:collapse;width:100%;}}th,td{{border:1px solid #ccc;padding:8px;}}</style></head><body><h1>Gestión Patrimonial Edificio ENKA</h1><hr>{c1}<hr>{c2}<hr>{c3}</body></html>')" 2>/dev/null || ( \
		echo "<html><body><h1>Expediente ENKA</h1><pre>" > evidencia/index.html && \
		cat specs/carta_alcaldia.md specs/dossier_tecnico.md tasks/checklist_expediente.md >> evidencia/index.html && \
		echo "</pre></body></html>" >> evidencia/index.html \
	)
	@echo "[✓] Compilación completada: evidencia/index.html"

serve: build
	@echo "[+] Iniciando servidor HTTP local en puerto 8080..."
	@python3 -m http.server 8080 --directory evidencia

verify:
	@engram doctor --project $(ENGRAM_PROJECT)

status:
	@git status -s 2>/dev/null || echo "[!] Warning: Git status omitido por permisos del sistema"
	@engram stats
