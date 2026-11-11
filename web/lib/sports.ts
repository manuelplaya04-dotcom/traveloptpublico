// Deportes en la ciudad: SOLO información estática y verificable (equipo, liga y estadio). No hay calendario: sin una
// API gratuita y estable con los partidos reales, mostrar fechas sería inventarlas. El botón lleva a la búsqueda del
// equipo en Ticketmaster, donde la persona ve el calendario oficial y las entradas.
export type League = "NBA" | "NHL" | "MLB" | "NFL" | "MLS";
export type Team = { name: string; league: League; venue: string };

export const TEAMS_BY_CITY: Record<string, Team[]> = {
  NYC: [
    { name: "New York Knicks", league: "NBA", venue: "Madison Square Garden" },
    { name: "New York Rangers", league: "NHL", venue: "Madison Square Garden" },
    { name: "New York Yankees", league: "MLB", venue: "Yankee Stadium" },
    { name: "New York Mets", league: "MLB", venue: "Citi Field" },
    { name: "New York Giants", league: "NFL", venue: "MetLife Stadium" },
    { name: "New York City FC", league: "MLS", venue: "Yankee Stadium" },
  ],
  BKN: [{ name: "Brooklyn Nets", league: "NBA", venue: "Barclays Center" }],
  ORL: [
    { name: "Orlando Magic", league: "NBA", venue: "Kia Center" },
    { name: "Orlando City SC", league: "MLS", venue: "Inter&Co Stadium" },
  ],
  MIA: [
    { name: "Miami Heat", league: "NBA", venue: "Kaseya Center" },
    { name: "Miami Marlins", league: "MLB", venue: "loanDepot park" },
    { name: "Miami Dolphins", league: "NFL", venue: "Hard Rock Stadium" },
    { name: "Florida Panthers", league: "NHL", venue: "Amerant Bank Arena" },
    { name: "Inter Miami CF", league: "MLS", venue: "Chase Stadium" },
  ],
  PHL: [
    { name: "Philadelphia 76ers", league: "NBA", venue: "Wells Fargo Center" },
    { name: "Philadelphia Flyers", league: "NHL", venue: "Wells Fargo Center" },
    { name: "Philadelphia Phillies", league: "MLB", venue: "Citizens Bank Park" },
    { name: "Philadelphia Eagles", league: "NFL", venue: "Lincoln Financial Field" },
    { name: "Philadelphia Union", league: "MLS", venue: "Subaru Park" },
  ],
  BOS: [
    { name: "Boston Celtics", league: "NBA", venue: "TD Garden" },
    { name: "Boston Bruins", league: "NHL", venue: "TD Garden" },
    { name: "Boston Red Sox", league: "MLB", venue: "Fenway Park" },
    { name: "New England Patriots", league: "NFL", venue: "Gillette Stadium" },
    { name: "New England Revolution", league: "MLS", venue: "Gillette Stadium" },
  ],
  WAS: [
    { name: "Washington Wizards", league: "NBA", venue: "Capital One Arena" },
    { name: "Washington Capitals", league: "NHL", venue: "Capital One Arena" },
    { name: "Washington Nationals", league: "MLB", venue: "Nationals Park" },
    { name: "D.C. United", league: "MLS", venue: "Audi Field" },
  ],
};

/** Calendario oficial y entradas: búsqueda del equipo en Ticketmaster (URL de búsqueda pública). */
export const ticketsUrl = (team: Team) => `https://www.ticketmaster.com/search?q=${encodeURIComponent(team.name)}`;
