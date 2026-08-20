import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { fetchJson, num, str } from "../utils.js";

/**
 * Weather module — Open-Meteo public API, no API key required.
 */

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

const getJson = (url: string) => fetchJson(url, "Open-Meteo");

interface GeoHit {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

/** Resolve a place name (or lat,lon string) to coordinates. */
async function geocode(place: string): Promise<GeoHit> {
  const trimmed = place.trim();
  const direct = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(trimmed);
  if (direct) {
    const [lat, lon] = trimmed.split(",").map((p) => parseFloat(p));
    return { name: `${lat},${lon}`, latitude: lat, longitude: lon };
  }
  const data = (await getJson(`${GEO}?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`)) as {
    results?: GeoHit[];
  };
  const hit = data.results?.[0];
  if (!hit) throw new Error(`Could not find a place named "${trimmed}"`);
  return hit;
}

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

function describe(code: number): string {
  return WEATHER_CODES[code] ?? `Weather code ${code}`;
}

export const weatherDefs: ToolDef[] = [
  {
    name: "weather_current",
    description:
      "Current weather conditions for a place or coordinates — temperature, feels-like, humidity, wind speed, and condition. Place can be a city name (\"London\", \"New York\") or \"lat,lon\".",
    inputSchema: {
      type: "object",
      properties: { place: { type: "string", description: "City name or \"lat,lon\" coordinates" } },
      required: ["place"],
    },
    handler: async (args) => {
      const place = str(args.place, "");
      const geo = await geocode(place);
      const data = (await getJson(
        `${FORECAST}?latitude=${geo.latitude}&longitude=${geo.longitude}` +
          "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl&timezone=auto",
      )) as { current?: Record<string, unknown>; current_units?: Record<string, unknown> };
      const c = (data.current ?? {}) as Record<string, number>;
      return jsonResult({
        place: `${geo.name}${geo.admin1 ? `, ${geo.admin1}` : ""}${geo.country ? `, ${geo.country}` : ""}`,
        latitude: geo.latitude,
        longitude: geo.longitude,
        observed_at: c.time,
        condition: describe(c.weather_code as number),
        temperature_c: c.temperature_2m,
        feels_like_c: c.apparent_temperature,
        humidity_pct: c.relative_humidity_2m,
        wind_speed_kmh: c.wind_speed_10m,
        wind_direction_deg: c.wind_direction_10m,
        pressure_hpa: c.pressure_msl,
        is_day: Boolean(c.is_day),
        units: data.current_units ?? {},
      });
    },
  },
  {
    name: "weather_forecast",
    description:
      "Daily weather forecast for a place — high/low temperature, precipitation probability, and condition for each day (default 5 days, max 14).",
    inputSchema: {
      type: "object",
      properties: {
        place: { type: "string", description: "City name or \"lat,lon\" coordinates" },
        days: { type: "integer", minimum: 1, maximum: 14, description: "Number of days (default 5)" },
      },
      required: ["place"],
    },
    handler: async (args) => {
      const place = str(args.place, "");
      const days = num(args.days, 5);
      const geo = await geocode(place);
      const data = (await getJson(
        `${FORECAST}?latitude=${geo.latitude}&longitude=${geo.longitude}` +
          "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=" +
          days,
      )) as { daily?: Record<string, unknown> };
      const d = (data.daily ?? {}) as Record<string, unknown[]>;
      const daysArr = (d.time ?? []).map((t, i) => ({
        date: t,
        condition: describe(Number(d.weather_code?.[i] ?? 0)),
        high_c: d.temperature_2m_max?.[i],
        low_c: d.temperature_2m_min?.[i],
        precip_probability_pct: d.precipitation_probability_max?.[i],
        sunrise: d.sunrise?.[i],
        sunset: d.sunset?.[i],
      }));
      return jsonResult({
        place: `${geo.name}${geo.admin1 ? `, ${geo.admin1}` : ""}${geo.country ? `, ${geo.country}` : ""}`,
        latitude: geo.latitude,
        longitude: geo.longitude,
        days: daysArr,
      });
    },
  },
  {
    name: "weather_geocode",
    description: "Resolve a place name to its latitude/longitude (useful for other location-based tools).",
    inputSchema: {
      type: "object",
      properties: { place: { type: "string", description: "City name or region" } },
      required: ["place"],
    },
    handler: async (args) => {
      const geo = await geocode(str(args.place, ""));
      return jsonResult({
        name: geo.name,
        admin1: geo.admin1 ?? null,
        country: geo.country ?? null,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
    },
  },
];
