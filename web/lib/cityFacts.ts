// Datos curiosos para la pantalla de espera: hechos históricos o geográficos estables, sin precios ni horarios.
// Sin datos de una ciudad no se muestra nada (no se inventa). Fuera del motor: se dibujan al instante.
export const CITY_FACTS: Record<string, string[]> = {
  NYC: [
    "El puente de Brooklyn se inauguró en 1883.",
    "La Estatua de la Libertad fue un regalo de Francia, inaugurado en 1886.",
    "El Central Park abrió sus primeras áreas al público en 1858.",
  ],
  ORL: [
    "Magic Kingdom, el primer parque de Walt Disney World, abrió en 1971.",
    "El Centro Espacial Kennedy, de donde partieron las misiones Apolo, queda a alrededor de una hora en auto.",
  ],
  MIA: [
    "Miami se fundó como ciudad en 1896.",
    "El distrito Art Deco de Miami Beach fue el primero del siglo XX en entrar al registro histórico nacional de EE. UU.",
  ],
  PHL: [
    "En el Independence Hall de Filadelfia se aprobó la Declaración de Independencia en 1776.",
    "Filadelfia fue capital de Estados Unidos de 1790 a 1800.",
  ],
  BOS: [
    "El Boston Common, de 1634, es el parque público más antiguo de Estados Unidos.",
    "La Maratón de Boston se corre desde 1897.",
  ],
  WAS: [
    "Washington D.C. es capital de Estados Unidos desde 1800.",
    "Los museos del Smithsonian tienen entrada gratuita.",
  ],
  BKN: [
    "Brooklyn fue una ciudad independiente hasta 1898.",
    "Coney Island tiene una montaña rusa de madera de 1927, el Cyclone.",
  ],
};

export const factsFor = (codes: string[]): string[] => codes.flatMap((c) => CITY_FACTS[c] ?? []);
