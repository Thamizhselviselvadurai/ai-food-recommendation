import { useEffect } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import { CROWD_LEVELS } from '../lib/constants.js';
import { rupees } from '../lib/format.js';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors';

// Crowd level uses the fixed status palette, and every marker also carries the
// venue emoji plus a text label in its tooltip — never colour alone.
const CROWD_FILL = {
  low: '#0ca30c',
  moderate: '#fab219',
  high: '#d03b3b',
};

const pinIcon = (place) =>
  L.divIcon({
    className: '',
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:50%;
      background:${place.crowd?.isOpen ? CROWD_FILL[place.crowd.level] ?? '#64748b' : '#94a3b8'};
      border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:16px;
    ">${place.emoji ?? '🍽️'}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });

function Recentre({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

/**
 * Map discovery built on Leaflet + OpenStreetMap tiles — a documented, public
 * tile service. Nothing here scrapes or embeds a proprietary maps product.
 */
export function MapView({ places = [], center, height = 'h-80', onSelect }) {
  if (!center) return null;

  return (
    <div className={`${height} overflow-hidden rounded-2xl border border-ink-200 dark:border-ink-800`}>
      <MapContainer center={[center.lat, center.lng]} zoom={14} scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <Recentre center={center} />

        {/* The user's own position — deliberately drawn as an approximate area. */}
        <CircleMarker
          center={[center.lat, center.lng]}
          radius={9}
          pathOptions={{ color: '#2a78d6', fillColor: '#2a78d6', fillOpacity: 0.35, weight: 2 }}
        >
          <Tooltip>You are around here</Tooltip>
        </CircleMarker>

        {places
          .filter((place) => place.coordinates)
          .map((place) => (
            <Marker
              key={place.id}
              position={[place.coordinates.lat, place.coordinates.lng]}
              icon={pinIcon(place)}
              eventHandlers={{ click: () => onSelect?.(place) }}
            >
              <Popup>
                <div className="min-w-[180px]">
                  <p className="text-sm font-bold">{place.name}</p>
                  <p className="text-xs text-slate-600">
                    {place.distanceLabel} · ★ {place.rating?.toFixed(1)} · {rupees(place.avgCostForOne)} for one
                  </p>
                  <p className="mt-1 text-xs">
                    {place.crowd?.isOpen
                      ? `${CROWD_LEVELS[place.crowd.level]?.emoji} ${CROWD_LEVELS[place.crowd.level]?.label} · ${place.crowd.waitMinutes.label}`
                      : '⚪ Closed right now'}
                  </p>
                  <Link to={`/restaurant/${place.id}`} className="mt-2 inline-block text-xs font-bold text-orange-600">
                    View food →
                  </Link>
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}
