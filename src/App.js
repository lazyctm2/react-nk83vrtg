import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { supabase } from './supabaseClient';
import 'leaflet/dist/leaflet.css';

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

  useEffect(() => {
    const container = L.DomUtil.get('map');
    if (!container) return;

    const map = L.map(container).setView([-33.456, -70.648], 14);
    mapRef.current = map;

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }
    ).addTo(map);

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
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div style={headerLeftStyle}>
          <span style={logoStyle}>🚨</span>
          <span style={titleStyle}>Alerta Ciudadana</span>
        </div>
        <div style={statusStyle}>
          <span style={{ ...gpsDotStyle, background: gpsColors[gpsStatus] }} />
          <span style={gpsTextStyle}>{gpsLabels[gpsStatus]}</span>
          <span style={dividerStyle} />
          <span style={usersStyle}>{onlineUsers} en línea</span>
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
          style={overlayStyle}
          onClick={() => {
            setModalOpen(false);
            setSeleccion(null);
          }}
        >
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
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
                    style={{ ...cardStyle, borderColor: opt.color }}
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
                  style={{ ...actionBtnStyle, background: '#3b82f6' }}
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
                  style={inputStyle}
                  onKeyDown={(e) => e.key === 'Enter' && handleUseAddress()}
                />
                <button
                  style={{
                    ...actionBtnStyle,
                    background: '#22c55e',
                    opacity: direccion.trim() ? 1 : 0.5,
                  }}
                  onClick={handleUseAddress}
                  disabled={enviando || !direccion.trim()}
                >
                  <span style={actionIconStyle}>📌</span> Enviar
                </button>
                <button
                  style={backBtnStyle}
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
  background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)',
  color: '#fff',
  padding: '12px 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
  zIndex: 100,
};
const headerLeftStyle = { display: 'flex', alignItems: 'center', gap: 10 };
const logoStyle = { fontSize: 24 };
const titleStyle = { fontSize: 18, fontWeight: 600, letterSpacing: '0.3px' };
const statusStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(255,255,255,0.1)',
  padding: '6px  14px',
  borderRadius: 20,
  fontSize: 13,
};
const gpsDotStyle = { width: 8, height: 8, borderRadius: '50%' };
const gpsTextStyle = { opacity: 0.9 };
const dividerStyle = {
  width: 1,
  height: 16,
  background: 'rgba(255,255,255,0.3)',
  margin: '0 4px',
};
const usersStyle = { opacity: 0.9 };
const mapStyle = { flex: 1, width: '100%' };
const centerBtnStyle = {
  position: 'fixed',
  right: 20,
  bottom: 100,
  width: 52,
  height: 52,
  borderRadius: 16,
  background: '#fff',
  border: 'none',
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
};
const fabStyle = {
  position: 'fixed',
  right: 20,
  bottom: 30,
  height: 52,
  borderRadius: 26,
  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
  border: 'none',
  boxShadow: '0 4px 20px rgba(239,68,68,0.4)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 20px 0 16px',
  cursor: 'pointer',
  zIndex: 50,
};
const fabIconStyle = { fontSize: 28, color: '#fff', fontWeight: 300 };
const fabTextStyle = { fontSize: 16, fontWeight: 600, color: '#fff' };
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
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
