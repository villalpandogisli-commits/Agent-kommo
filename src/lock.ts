/**
 * MECANISMO 2 — Candado por contacto.
 * Serializa el trabajo por lead: si llegan 3 mensajes seguidos, se procesan
 * en orden y las respuestas no se pisan.
 *
 * Nota: este candado es en memoria (sirve para 1 instancia). Si escalas a
 * varias instancias, cambia esto por un lock en Supabase/Redis.
 */
const cadenas = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previo = cadenas.get(key) ?? Promise.resolve();
  const siguiente = previo.catch(() => {}).then(fn);
  // Guarda la cadena; al terminar, límpiala si nadie más se encoló.
  cadenas.set(
    key,
    siguiente.finally(() => {
      if (cadenas.get(key) === siguiente) cadenas.delete(key);
    })
  );
  return siguiente;
}
