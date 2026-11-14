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
  LAX: [
    "El cartel de Hollywood se levantó en 1923 como publicidad inmobiliaria: decía «Hollywoodland».",
    "Los Ángeles fue sede de los Juegos Olímpicos de 1932 y 1984.",
  ],
  SFO: [
    "El puente Golden Gate se inauguró en 1937.",
    "Los cable cars de San Francisco circulan desde 1873.",
  ],
  LAS: [
    "Las Vegas se fundó como ciudad en 1905.",
    "La represa Hoover, a unos 50 km de la ciudad, se terminó en 1936.",
  ],
  BAR: [
    "El Parque Nacional Nahuel Huapi, que rodea Bariloche, es el más antiguo de la Argentina (1934).",
    "El Centro Cívico, de piedra y madera, se inauguró en 1940.",
  ],
  VLA: [
    "Villa La Angostura está en la orilla norte del lago Nahuel Huapi.",
    "El Parque Nacional Los Arrayanes protege un bosque de arrayanes en la península de Quetrihué.",
  ],
  SMA: [
    "San Martín de los Andes se fundó en 1898, a orillas del lago Lácar.",
    "Es uno de los extremos de la Ruta de los Siete Lagos, que llega hasta Villa La Angostura.",
  ],
  VPH: [
    "Villa Pehuenia está a orillas del lago Aluminé, entre bosques de pehuenes (araucarias).",
    "El pehuén, o araucaria, puede vivir más de mil años.",
  ],
  RIO: [
    "El Cristo Redentor, en el cerro del Corcovado, se inauguró en 1931.",
    "Río de Janeiro fue la capital de Brasil hasta 1960, cuando se mudó a Brasilia.",
  ],
  SSA: [
    "Salvador fue la primera capital de Brasil, de 1549 a 1763.",
    "Su centro histórico, el Pelourinho, es Patrimonio de la Humanidad desde 1985.",
  ],
  MCZ: [
    "Maceió es la capital del estado de Alagoas.",
    "Con la marea baja, frente a la playa de Pajuçara se forman piscinas naturales entre los arrecifes.",
  ],
  AJU: [
    "Aracaju se fundó en 1855 para reemplazar a São Cristóvão como capital de Sergipe.",
  ],
  CNV: [
    "Canasvieiras está en el norte de la isla de Santa Catarina, donde se encuentra Florianópolis.",
    "El puente Hercílio Luz, que une la isla con el continente, se inauguró en 1926.",
  ],
  BUZ: [
    "Búzios se hizo famosa en los años 60, tras la visita de Brigitte Bardot.",
    "La península de Búzios tiene más de 20 playas.",
  ],
  CFR: [
    "Cabo Frío, fundada en 1615, es una de las ciudades más antiguas de Brasil.",
  ],
  ARC: [
    "El agua de Arraial do Cabo es fría y muy clara por la surgencia: corrientes profundas que suben a la costa.",
  ],
  CAM: [
    "En Camaçari están las playas de Guarajuba e Itacimirim, en la costa norte de Bahía.",
  ],
  ARA: [
    "Arapiraca, en el agreste de Alagoas, fue durante décadas un gran centro de cultivo de tabaco.",
  ],
};

export const factsFor = (codes: string[]): string[] => codes.flatMap((c) => CITY_FACTS[c] ?? []);
