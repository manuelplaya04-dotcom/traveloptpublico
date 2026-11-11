import { describe, expect, it } from "vitest";
import { roadTrip } from "@/lib/geo";
import { buildIcs } from "@/lib/ics";
import type { ItineraryPayload } from "@/lib/types";

const payload = {
  skeleton_id: "ORL-NYC|2027-07-08",
  first_checkin: "2027-07-08",
  order: ["ORL"],
  flights: [{ leg: 0, cost_minor: 0, offer: {
    id: "f", provider: "x", origin: "EZE", destination: "MCO", depart_at: "2027-07-07T22:30:00", arrive_at: "2027-07-08T07:10:00",
    stops: 1, carrier: "AA", price_per_pax_minor: 0, included_bags: 0, bag_fee_minor: 0, seats_available: 9, deeplink: null } }],
  stays: [{ city: "ORL", check_in: "2027-07-08", check_out: "2027-07-14", nights: 6, activities: [], transport_cost_minor: 0,
    lodging: { offer_id: "h", name: "Villa 4 dorm., Kissimmee; con pileta", deeplink: null, cost_minor: 0, units: [] } }],
} as unknown as ItineraryPayload;

describe("exportación a calendario (.ics)", () => {
  const ics = buildIcs(payload, () => "Orlando", new Date("2026-11-03T21:00:00Z"));

  it("es un VCALENDAR válido con un evento por vuelo y por estadía", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTAMP:20261103T210000Z");
  });

  it("vuelos en hora local flotante y estadías de día completo", () => {
    expect(ics).toContain("DTSTART:20270707T223000\r\nDTEND:20270708T071000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270708\r\nDTEND;VALUE=DATE:20270714");
  });

  it("escapa comas y punto y coma, y pliega líneas largas a 75 octetos", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Villa 4 dorm.\\, Kissimmee\\; con pileta");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("rutas reales por calle", () => {
  it("cerca: tiempo a pie sobre la distancia real; lejos: tiempo en auto de OSRM", () => {
    expect(roadTrip({ distance_m: 1200, duration_s: 240 })).toEqual({ km: 1.2, minutes: 15, mode: "a pie", estimated: false });
    expect(roadTrip({ distance_m: 27903, duration_s: 1794 })).toEqual({ km: 27.9, minutes: 30, mode: "en auto", estimated: false });
  });
});
