import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { supabase } from './supabaseClient';
import 'leaflet/dist/leaflet.css';
import './style.css';
import logo from './logo.svg';

const LIGHT_TILE_LAYER = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const DARK_TILE_LAYER = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTRIBUTION = '&copy; OpenStreetMap &copy; CARTO';

const OPCIONES = [
  {
    id: 1,
    categoria: 'Seguridad',
    subtipo: 'Encerrona / Portonazo',
    emoji: '🚗',
    color: '#ef4444',
  },
  {
    id: 2,
    categoria: 'Seguridad',
    subtipo: 'Robo / Asalto',
    emoji: '👤',
    color: '#dc2626',
  },
  {
    id: 3,
    categoria: 'Seguridad',
    subtipo: 'Actividad Suspiciosas',
    emoji: '👀',
    color: '#f97316',
  },
  {
    id: 4,
    categoria: 'Emergencia',
    subtipo: 'Accidente de Tránsito',
    emoji: '💥',
    color: '#eab308',
  },
  {
    id: 5,
    categoria: 'Emergencia',
    subtipo: 'Incendio',
    emoji: '🔥',
    color: '#f59e0b',
  },
  {
    id: 6,
    categoria: 'Salud',
    subtipo: 'Urgencia Médica',
    emoji: '🚑',
    color: '#22c55e',
  },
];

const EMOJI_MAP = new Map(
  OPCIONES.map((o) => [o.subtipo, { emoji: o.emoji, color: o.color }])
);
const USER_ID = Math.random().toString(36).slice(2, 8);

const parseCoords = (pos) => {
  if (!pos) return null;
  if (typeof pos === 'object') return [pos.coordinates[1], pos.coordinates[0]];
  const match = pos.match(/POINT\(([^ ]+) ([^ ]+)\)/);
  return match ? [parseFloat(match[2]), parseFloat(match[1])] : null;
};

const crearIconoEmoji = (emoji, color) =>
  L.divIcon({
    html: `<div style="
      font-size: 32px;
      background: ${color}22;
      border: 3px solid ${color};
      border-radius: 50%;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px ${color}44;
    ">${emoji}</div>`,
    className: '',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });

const crearIconoUsuario = (esPropio = true) =>
  L.divIcon({
    html: `<div class="user-marker">
            <div class="user-pulse" style="background: ${
              esPropio ? 'rgba(59, 130, 246, 0.4)' : 'rgba(16, 185, 129, 0.4)'
            }"></div>
            <div class="user-core" style="background: ${
              esPropio ? '#3b82f6' : '#10b981'
            }"></div>
           </div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

export default function App() {
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const channelRef = useRef(null);
  const watchIdRef = useRef(null);
  const markersRef = useRef([]);
  const presenceChannelRef = useRef(null);
  const followingRef = useRef(true);
  const lastBroadcastRef = useRef(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [seleccion, setSeleccion] = useState(null);
  const [direccion, setDireccion] = useState('');
  const [gpsStatus, setGpsStatus] = useState('off');
  const [onlineUsers, setOnlineUsers] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const tileLayerRef = useRef(null);

  useEffect(() => {
    const container = L.DomUtil.get('map');
    if (!container) return;

    const map = L.map(container).setView([-33.456, -70.648], 14);
    mapRef.current = map;

    tileLayerRef.current = L.tileLayer(LIGHT_TILE_LAYER, {
      attribution: ATTRIBUTION,
    }).addTo(map);

    map.on('dragstart', () => {
      followingRef.current = false;
    });

    loadIncidents();
    initRealtime();
    initPresence();

    if (navigator.geolocation) {
      setGpsStatus('searching');

      watchIdRef.current = navigator.geolocation.watchPosition(
        ({ coords }) => {
          const pos = [coords.latitude, coords.longitude];
          setGpsStatus('active');

          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng(pos);
            accuracyCircleRef.current?.setLatLng(pos);
            accuracyCircleRef.current?.setRadius(coords.accuracy);
          } else {
            userMarkerRef.current = L.marker(pos, {
              icon: crearIconoUsuario(true),
              zIndexOffset: 1000,
            })
              .addTo(map)
              .bindPopup('Tu ubicación');

            accuracyCircleRef.current = L.circle(pos, {
              radius: coords.accuracy,
              color: '#3b82f6',
              fillColor: '#3b82f6',
              fillOpacity: 0.1,
              weight: 2,
              opacity: 0.4,
            }).addTo(map);
          }

          if (followingRef.current) {
            map.setView(pos, map.getZoom(), { animate: true });
          }

          const ahora = Date.now();
          if (ahora - lastBroadcastRef.current > 5000) {
            broadcastPosition(coords.latitude, coords.longitude);
            lastBroadcastRef.current = ahora;
          }
        },
        (error) => {
          console.error('Error de GPS:', error);
          setGpsStatus('error');
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
    } else {
      setGpsStatus('error');
    }

    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (presenceChannelRef.current)
        supabase.removeChannel(presenceChannelRef.current);

      markersRef.current.forEach((m) => m.remove());

      map.off();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = L.tileLayer(darkMode ? DARK_TILE_LAYER : LIGHT_TILE_LAYER, {
      attribution: ATTRIBUTION,
    }).addTo(mapRef.current);
    mapRef.current.invalidateSize();
  }, [darkMode]);

  const loadIncidents = async () => {
    const { data, error } = await await supabase.from('siniestros').select('*');
    if (error) return console.error(error);
    data?.forEach(addIncidentMarker);
  };

  const initRealtime = () => {
    const channel = supabase.channel('incidents');
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'siniestros' },
      (payload) => {
        if (payload.new) addIncidentMarker(payload.new);
      }
    );
    channel.subscribe();
    channelRef.current = channel;
  };

  const broadcastPosition = (lat, lng) => {
    presenceChannelRef.current?.track({ lat, lng, online_at: Date.now() });
  };

  const initPresence = () => {
    const channel = supabase.channel('user-locations', {
      config: { presence: { key: USER_ID } },
    });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      setOnlineUsers(Object.keys(state).length);
      // Se eliminó por completo el renderizado de marcadores de otros usuarios
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') channel.track({ online_at: Date.now() });
    });
    presenceChannelRef.current = channel;
  };

  const addIncidentMarker = (s) => {
    if (!mapRef.current) return;
    const coords = parseCoords(s.posicion);
    if (!coords) return;

    const { emoji, color } = EMOJI_MAP.get(s.subtipo) || {
      emoji: '⚠️',
      color: '#6b7280',
    };
    const marker = L.marker(coords, {
      icon: crearIconoEmoji(emoji, color),
    }).addTo(mapRef.current)
      .bindPopup(`<div style="font-family:system-ui;padding:4px">
        <strong style="font-size:15px">${emoji} ${s.subtipo}</strong><br/>
        <span style="color:#6b7280;font-size:13px">${
          s.descripcion || 'Sin detalles'
        }</span>
      </div>`);
    markersRef.current.push(marker);
  };

  const handleSelectOption = (opt) => {
    setSeleccion(opt);
  };

  const handleUseLocation = async () => {
    if (!userMarkerRef.current) return alert('Aún no tenemos tu ubicación GPS');
    const { lat, lng } = userMarkerRef.current.getLatLng();
    await submitReport(lat, lng, 'Ubicación actual');
  };

  const handleUseAddress = async () => {
    if (!direccion.trim()) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          direccion
        )}`
      );
      const data = await res.json();
      if (!data.length) return alert('Dirección no encontrada');
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      mapRef.current?.setView([lat, lng], 16);
      await submitReport(lat, lng, direccion);
    } catch {
      alert('Error al buscar dirección');
    }
  };

  const submitReport = async (lat, lng, desc) => {
    setEnviando(true);
    const { error } = await supabase.from('siniestros').insert([
      {
        categoria: seleccion.categoria,
        subtipo: seleccion.subtipo,
        descripcion: desc,
        posicion: `POINT(${lng} ${lat})`,
      },
    ]);
    setEnviando(false);

    if (error) return alert('Error: ' + error.message);

    setExito(true);
    setTimeout(() => {
      setExito(false);
      setModalOpen(false);
      setSeleccion(null);
      setDireccion('');
    }, 1500);
  };

  const centerOnUser = () => {
    if (!userMarkerRef.current || !mapRef.current) return;
    followingRef.current = true;
    mapRef.current.setView(userMarkerRef.current.getLatLng(), 16, {
      animate: true,
    });
  };

  const gpsLabels = {
    off: 'GPS apagado',
    searching: 'Buscando...',
    active: 'GPS activo',
    error: 'GPS error',
  };
  const gpsColors = {
    off: '#9ca3af',
    searching: '#f59e0b',
    active: '#22c55e',
    error: '#ef4444',
  };

  return (
    <div className={darkMode ? 'app-root dark-mode' : 'app-root'} style={containerStyle}>
      <header
        style={{
          ...headerStyle,
          background: darkMode ? '#111827' : '#ffffff',
          color: darkMode ? '#f8fafc' : '#111827',
          borderBottom: darkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid rgba(15, 23, 42, 0.08)',
        }}
      >
        <div style={headerLeftStyle}>
          <div style={brandStyle}>
            <img src={logo} alt="SITUA" style={logoStyle} />
            <span style={titleStyle}>SITUA</span>
          </div>
          <span style={headerSubtitleStyle}>Mapa de incidentes en tiempo real</span>
        </div>
        <div style={statusStyle}>
          <span style={{ ...gpsDotStyle, background: gpsColors[gpsStatus] }} />
          <span style={gpsTextStyle}>{gpsLabels[gpsStatus]}</span>
          <span style={dividerStyle} />
          <span style={usersStyle}>{onlineUsers} en línea</span>
          <button
            style={{
              ...themeBtnStyle,
              color: darkMode ? '#f8fafc' : '#0f172a',
              background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.9)',
              borderColor: darkMode ? 'rgba(148, 163, 184, 0.28)' : 'rgba(148, 163, 184, 0.32)',
            }}
            onClick={() => setDarkMode((prev) => !prev)}
            title={darkMode ? 'Modo claro' : 'Modo oscuro'}
          >
            {darkMode ? '☀️ Claro' : '🌙 Oscuro'}
          </button>
        </div>
      </header>

      <div id="map" style={mapStyle} />

      {gpsStatus === 'active' && (
        <button
          onClick={centerOnUser}
          style={centerBtnStyle}
          title="Centrar en mi ubicación"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      )}

      <button onClick={() => setModalOpen(true)} style={fabStyle}>
        <span style={fabIconStyle}>+</span>
        <span style={fabTextStyle}>Reportar</span>
      </button>

      {modalOpen && (
        <div
          className="modal-backdrop"
          style={overlayStyle}
          onClick={() => {
            setModalOpen(false);
            setSeleccion(null);
          }}
        >
          <div className="modal-sheet" style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <button
              style={closeBtnStyle}
              onClick={() => {
                setModalOpen(false);
                setSeleccion(null);
              }}
            >
              ×
            </button>

            <h2 style={modalTitleStyle}>
              {seleccion
                ? `${seleccion.emoji} ${seleccion.subtipo}`
                : '¿Qué está ocurriendo?'}
            </h2>
            <p style={modalSubtitleStyle}>
              {seleccion
                ? 'Confirma la ubicación del incidente'
                : 'Selecciona el tipo de incidente'}
            </p>

            {!seleccion ? (
              <div style={gridStyle}>
                {OPCIONES.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleSelectOption(opt)}
                    className="incident-card"
                    style={{ borderColor: opt.color }}
                  >
                    <span
                      style={{
                        ...cardEmojiStyle,
                        background: `${opt.color}15`,
                      }}
                    >
                      {opt.emoji}
                    </span>
                    <span style={cardTitleStyle}>{opt.subtipo}</span>
                    <span style={{ ...cardCatStyle, color: opt.color }}>
                      {opt.categoria}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={actionContainerStyle}>
                <button
                  className="primary-button"
                  onClick={handleUseLocation}
                  disabled={enviando}
                >
                  <span style={actionIconStyle}>📍</span> Usar mi ubicación
                </button>
                <div style={dividerTextStyle}>
                  <span>o ingresa una dirección</span>
                </div>
                <input
                  placeholder="Ej: Av. Alemania 123, Temuco"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  className="input-field"
                  onKeyDown={(e) => e.key === 'Enter' && handleUseAddress()}
                />
                <button
                  className="primary-button"
                  style={{ opacity: direccion.trim() ? 1 : 0.6 }}
                  onClick={handleUseAddress}
                  disabled={enviando || !direccion.trim()}
                >
                  <span style={actionIconStyle}>📌</span> Enviar
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setSeleccion(null)}
                  disabled={enviando}
                >
                  Volver
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {exito && (
        <div style={successOverlayStyle}>
          <div style={successBoxStyle}>
            <span style={successEmojiStyle}>✓</span>
            <span style={successTextStyle}>Alerta enviada</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.8; }
          50% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        .user-marker { position: relative; width: 32px; height: 32px; }
        .user-pulse {
          position: absolute; top: 50%; left: 50%;
          width: 24px; height: 24px; border-radius: 50%;
          animation: pulse 2s ease-out infinite;
        }
        .user-core {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 16px; height: 16px; border-radius: 50%;
          border: 3px solid #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
      `}</style>
    </div>
  );
}

const containerStyle = {
  height: '100vh',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  background: '#f5f5f5',
};
const headerStyle = {
  background: '#ffffff',
  color: '#111827',
  padding: '18px 26px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
  position: 'relative',
  zIndex: 100,
};
const headerLeftStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
const brandStyle = { display: 'flex', alignItems: 'center', gap: 12 };
const logoStyle = {
  fontSize: 28,
  width: 40,
  height: 40,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 14,
  background: 'rgba(37, 99, 235, 0.1)',
};
const titleStyle = { fontSize: 20, fontWeight: 700, letterSpacing: '0.2px' };
const headerSubtitleStyle = { fontSize: 13, color: '#475569' };
const statusStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  borderRadius: 999,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  fontSize: 13,
};
const gpsDotStyle = { width: 10, height: 10, borderRadius: '50%' };
const gpsTextStyle = { color: '#0f172a', fontWeight: 600 };
const dividerStyle = {
  width: 1,
  height: 20,
  background: '#cbd5e1',
};
const usersStyle = { color: '#475569' };
const mapStyle = {
  flex: 1,
  width: '100%',
  minHeight: 'calc(100vh - 82px)',
  position: 'relative',
  zIndex: 1,
};
const centerBtnStyle = {
  position: 'fixed',
  right: 20,
  bottom: 110,
  width: 52,
  height: 52,
  borderRadius: 16,
  background: '#ffffff',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  boxShadow: '0 18px 40px rgba(15,0,52,0.08)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1200,
  pointerEvents: 'auto',
};
const fabStyle = {
  position: 'fixed',
  right: 20,
  bottom: 30,
  height: 54,
  borderRadius: 999,
  background: '#2563eb',
  border: 'none',
  boxShadow: '0 18px 40px rgba(37, 99, 235, 0.18)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 20px',
  cursor: 'pointer',
  zIndex: 1200,
  pointerEvents: 'auto',
};
const fabIconStyle = { fontSize: 24, color: '#fff', fontWeight: 700 };
const themeBtnStyle = {
  background: 'transparent',
  border: '1px solid rgba(148, 163, 184, 0.32)',
  color: '#0f172a',
  borderRadius: 999,
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
};
const fabTextStyle = { fontSize: 15, fontWeight: 700, color: '#fff' };
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.32)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 200,
};
const modalStyle = {
  background: '#fff',
  width: '100%',
  maxWidth: 500,
  maxHeight: '85vh',
  borderRadius: '24px 24px 0 0',
  padding: 24,
  boxSizing: 'border-box',
  overflowY: 'auto',
  position: 'relative',
};
const closeBtnStyle = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 32,
  height: 32,
  borderRadius: '50%',
  border: 'none',
  background: '#f3f4f6',
  fontSize: 20,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
};
const modalTitleStyle = {
  fontSize: 22,
  fontWeight: 700,
  margin: 0,
  color: '#111',
};
const modalSubtitleStyle = { fontSize: 14, color: '#6b7280', marginTop: 6 };
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  marginTop: 20,
};
const cardStyle = {
  padding: 16,
  borderRadius: 16,
  border: '2px solid',
  background: '#fff',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'transform 0.15s',
};
const cardEmojiStyle = {
  fontSize: 32,
  display: 'block',
  marginBottom: 8,
  padding: 8,
  borderRadius: 12,
  width: 'fit-content',
};
const cardTitleStyle = {
  fontSize: 14,
  fontWeight: 600,
  color: '#111',
  display: 'block',
};
const cardCatStyle = { fontSize: 12, marginTop: 4, display: 'block' };
const actionContainerStyle = { marginTop: 20 };
const actionBtnStyle = {
  width: '100%',
  padding: 16,
  borderRadius: 12,
  color: '#fff',
  border: 'none',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  marginBottom: 12,
};
const actionIconStyle = { fontSize: 18 };
const dividerTextStyle = {
  textAlign: 'center',
  margin: '16px 0',
  color: '#9ca3af',
  fontSize: 13,
  position: 'relative',
};
const inputStyle = {
  width: '100%',
  padding: 14,
  borderRadius: 12,
  border: '2px solid #e5e7eb',
  fontSize: 15,
  boxSizing: 'border-box',
  marginBottom: 12,
  transition: 'border-color 0.2s',
};
const backBtnStyle = {
  width: '100%',
  padding: 14,
  borderRadius: 12,
  background: '#f3f4f6',
  border: 'none',
  fontSize: 15,
  cursor: 'pointer',
  color: '#6b7280',
};
const successOverlayStyle = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 300,
  background: 'rgba(0,0,0,0.3)',
};
const successBoxStyle = {
  background: '#fff',
  padding: 32,
  borderRadius: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
};
const successEmojiStyle = {
  fontSize: 48,
  width: 72,
  height: 72,
  borderRadius: '50%',
  background: '#22c55e',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 300,
};
const successTextStyle = { fontSize: 18, fontWeight: 600, color: '#111' };
