const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-top-read",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

const demoSongs = [
  song("midnight-city", "Midnight City", "M83", "Indie", "linear-gradient(135deg, #46c2d9, #3845a3 58%, #ff4f72)", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"),
  song("blinding-lights", "Blinding Lights", "The Weeknd", "Pop", "linear-gradient(135deg, #ff4f72, #6d1d45 58%, #f0b84c)", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"),
  song("bad-habit", "Bad Habit", "Steve Lacy", "Groove", "linear-gradient(135deg, #f0b84c, #466e52 55%, #101114)", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"),
  song("heat-waves", "Heat Waves", "Glass Animals", "Alt", "linear-gradient(135deg, #ff8d4f, #cf3a55 52%, #29324d)", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3"),
  song("levitating", "Levitating", "Dua Lipa", "Dance", "linear-gradient(135deg, #9b7cff, #243e9a 55%, #1ed760)", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3"),
  song("as-it-was", "As It Was", "Harry Styles", "Radio", "linear-gradient(135deg, #6d8cff, #46c2d9 48%, #f4db7d)", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3"),
];

function song(id, title, artist, ownerHint, cover, preview) {
  return { id, title, artist, ownerHint, cover, preview, uri: null, spotifyUrl: null, embedUrl: null };
}

function createInitialState() {
  return {
    lobbyCode: makeCode(),
    players: [
      { id: crypto.randomUUID(), name: "Mia", picks: ["midnight-city", "bad-habit", "as-it-was"], spotifyId: null },
      { id: crypto.randomUUID(), name: "Noah", picks: ["blinding-lights", "heat-waves", "levitating"], spotifyId: null },
    ],
    spotifySongs: [],
    deck: [],
    currentIndex: 0,
    votes: {},
    playlist: [],
    playlistUrl: "",
    rounds: 0,
    updatedAt: Date.now(),
  };
}

let state = loadState();
let spotifyToken = loadToken();
let spotifyProfile = null;
let applyingRemoteState = false;
let pushTimer = null;

const els = {
  lobbyCode: document.querySelector("#lobbyCode"),
  playerCount: document.querySelector("#playerCount"),
  roundCount: document.querySelector("#roundCount"),
  playlistCount: document.querySelector("#playlistCount"),
  deckCount: document.querySelector("#deckCount"),
  players: document.querySelector("#players"),
  playerForm: document.querySelector("#playerForm"),
  playerName: document.querySelector("#playerName"),
  songLibrary: document.querySelector("#songLibrary"),
  roundDeck: document.querySelector("#roundDeck"),
  swipeStage: document.querySelector("#swipeStage"),
  playlist: document.querySelector("#playlist"),
  playlistMeta: document.querySelector("#playlistMeta"),
  playlistLink: document.querySelector("#playlistLink"),
  spotifyStatus: document.querySelector("#spotifyStatus"),
  clientIdInput: document.querySelector("#clientIdInput"),
  syncStatus: document.querySelector("#syncStatus"),
  lobbyLink: document.querySelector("#lobbyLink"),
  joinLobbyForm: document.querySelector("#joinLobbyForm"),
  joinCode: document.querySelector("#joinCode"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
};

els.clientIdInput.value = localStorage.getItem("soundmatch-client-id") || "";
els.clientIdInput.addEventListener("change", () => {
  localStorage.setItem("soundmatch-client-id", els.clientIdInput.value.trim());
});

document.querySelector("#spotifyLoginBtn").addEventListener("click", loginSpotify);
document.querySelector("#spotifyLogoutBtn").addEventListener("click", logoutSpotify);
document.querySelector("#importSpotifyBtn").addEventListener("click", importSpotifyTopTracks);
document.querySelector("#createSpotifyPlaylistBtn").addEventListener("click", createSpotifyPlaylist);
document.querySelector("#copyLobbyBtn").addEventListener("click", copyLobbyLink);

document.querySelector("#newLobbyBtn").addEventListener("click", () => {
  state = createInitialState();
  saveState();
  updateLobbyUrl();
  render();
  showView("setup");
});

document.querySelector("#resetBtn").addEventListener("click", () => {
  localStorage.removeItem("soundmatch-state");
  state = createInitialState();
  saveState();
  render();
  showView("setup");
});

document.querySelector("#startRoundBtn").addEventListener("click", startRound);
document.querySelector("#continueBtn").addEventListener("click", () => showView("setup"));
document.querySelector("#shuffleBtn").addEventListener("click", () => {
  state.deck = shuffle(buildDeck());
  state.currentIndex = 0;
  state.votes = {};
  saveState();
  render();
});

document.querySelector("#copyBtn").addEventListener("click", async (event) => {
  const text = state.playlist.map((id, index) => {
    const item = getSong(id);
    return `${index + 1}. ${item.title} - ${item.artist}${item.spotifyUrl ? ` (${item.spotifyUrl})` : ""}`;
  }).join("\n");
  await navigator.clipboard.writeText(text || "Soundmatch Playlist");
  event.currentTarget.textContent = "Kopiert";
  setTimeout(() => {
    event.currentTarget.innerHTML = '<span aria-hidden="true">⧉</span>Kopieren';
  }, 1200);
});

els.playerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.playerName.value.trim();
  if (!name) return;
  state.players.push({ id: crypto.randomUUID(), name, picks: [], spotifyId: null });
  els.playerName.value = "";
  saveState();
  render();
});

els.joinLobbyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = els.joinCode.value.trim().toUpperCase();
  if (!code) return;
  await joinLobby(code);
});

els.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));

boot();

async function boot() {
  await handleSpotifyCallback();
  await initSpotifyProfile();
  await initSharedLobby();
  render();
  setInterval(pullLobby, 2500);
}

async function initSharedLobby() {
  const url = new URL(location.href);
  const code = url.searchParams.get("lobby");
  if (code && code.toUpperCase() !== state.lobbyCode) {
    await joinLobby(code);
    return;
  }
  updateLobbyUrl();
  await pushLobby();
}

function loadState() {
  const saved = localStorage.getItem("soundmatch-state");
  if (!saved) return createInitialState();
  try {
    return { ...createInitialState(), ...JSON.parse(saved) };
  } catch {
    return createInitialState();
  }
}

function saveState() {
  if (!applyingRemoteState) state.updatedAt = Date.now();
  localStorage.setItem("soundmatch-state", JSON.stringify(state));
  queueLobbyPush();
}

function loadToken() {
  const saved = localStorage.getItem("soundmatch-token");
  return saved ? JSON.parse(saved) : null;
}

function saveToken(token) {
  spotifyToken = token;
  localStorage.setItem("soundmatch-token", JSON.stringify(token));
}

async function joinLobby(code) {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return;
  setSyncStatus("lade");
  const remote = await fetchLobby(normalized);
  applyingRemoteState = true;
  if (remote && remote.state) {
    state = { ...createInitialState(), ...remote.state, lobbyCode: normalized };
  } else {
    state = { ...createInitialState(), lobbyCode: normalized };
  }
  saveState();
  applyingRemoteState = false;
  updateLobbyUrl();
  els.joinCode.value = "";
  render();
  await pushLobby();
}

function queueLobbyPush() {
  if (applyingRemoteState) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushLobby, 350);
}

async function pushLobby() {
  clearTimeout(pushTimer);
  try {
    setSyncStatus("sync");
    const response = await fetch(`/api/lobby?code=${encodeURIComponent(state.lobbyCode)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, updatedAt: state.updatedAt || Date.now() }),
    });
    if (!response.ok) throw new Error("sync failed");
    const data = await response.json();
    setSyncStatus(data.storage === "kv" ? "online" : "memory");
  } catch {
    setSyncStatus("lokal");
  }
}

async function pullLobby() {
  if (!state.lobbyCode) return;
  const remote = await fetchLobby(state.lobbyCode);
  if (!remote || !remote.state) return;
  const remoteUpdated = Number(remote.updatedAt || remote.state.updatedAt || 0);
  const localUpdated = Number(state.updatedAt || 0);
  if (remoteUpdated <= localUpdated) return;
  applyingRemoteState = true;
  state = { ...createInitialState(), ...remote.state };
  localStorage.setItem("soundmatch-state", JSON.stringify(state));
  applyingRemoteState = false;
  render();
  setSyncStatus("online");
}

async function fetchLobby(code) {
  try {
    const response = await fetch(`/api/lobby?code=${encodeURIComponent(code)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("fetch failed");
    return response.json();
  } catch {
    setSyncStatus("lokal");
    return null;
  }
}

function updateLobbyUrl() {
  const url = new URL(location.href);
  url.searchParams.set("lobby", state.lobbyCode);
  history.replaceState({}, document.title, url.toString());
}

function lobbyUrl() {
  const url = new URL(location.href);
  url.searchParams.set("lobby", state.lobbyCode);
  return url.toString();
}

async function copyLobbyLink(event) {
  await navigator.clipboard.writeText(lobbyUrl());
  event.currentTarget.textContent = "Kopiert";
  setTimeout(() => {
    event.currentTarget.innerHTML = '<span aria-hidden="true">⧉</span>Link kopieren';
  }, 1200);
}

function setSyncStatus(status) {
  if (els.syncStatus) els.syncStatus.textContent = status;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function allSongs() {
  const byId = new Map(demoSongs.map((item) => [item.id, item]));
  state.spotifySongs.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

function getSong(id) {
  return allSongs().find((item) => item.id === id) || demoSongs[0];
}

function showView(view) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  els.views.forEach((panel) => panel.classList.toggle("active", panel.id === `${view}View`));
  render();
}

function render() {
  els.lobbyCode.textContent = `Lobby ${state.lobbyCode}`;
  els.lobbyLink.value = lobbyUrl();
  els.playerCount.textContent = state.players.length;
  els.roundCount.textContent = state.rounds;
  els.playlistCount.textContent = state.playlist.length;
  els.deckCount.textContent = Math.max(state.deck.length - state.currentIndex, 0);
  els.spotifyStatus.textContent = spotifyProfile ? spotifyProfile.display_name || spotifyProfile.id : "offline";
  renderPlayers();
  renderSongLibrary();
  renderDeck();
  renderSwipe();
  renderPlaylist();
}

function renderPlayers() {
  if (!state.players.length) {
    els.players.innerHTML = emptyMarkup("Keine Spieler", "Namen hinzufügen");
    return;
  }
  els.players.innerHTML = state.players.map((player) => `
    <div class="player-pill">
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <small>${player.picks.length} Songs${player.spotifyId ? " · Spotify" : ""}</small>
      </div>
      <button type="button" title="Entfernen" aria-label="${escapeHtml(player.name)} entfernen" data-remove-player="${player.id}">×</button>
    </div>
  `).join("");
  els.players.querySelectorAll("[data-remove-player]").forEach((button) => {
    button.addEventListener("click", () => {
      state.players = state.players.filter((player) => player.id !== button.dataset.removePlayer);
      saveState();
      render();
    });
  });
}

function renderSongLibrary() {
  els.songLibrary.innerHTML = allSongs().map((item) => {
    const pickedBy = state.players.filter((player) => player.picks.includes(item.id));
    return `
      <article class="song-card" style="--cover: ${coverCss(item.cover)}">
        <div class="cover" aria-hidden="true"></div>
        <div class="song-card-body">
          <h3>${escapeHtml(item.title)}</h3>
          <p class="artist">${escapeHtml(item.artist)}</p>
          <div class="pick-row">
            <select data-pick-song="${item.id}" aria-label="${escapeHtml(item.title)} Spieler wählen">
              <option value="">Spieler</option>
              ${state.players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("")}
            </select>
            <button class="toggle ${pickedBy.length ? "active" : ""}" type="button" title="${pickedBy.map((player) => player.name).join(", ") || item.ownerHint}" data-song-info="${item.id}">${pickedBy.length || "＋"}</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  els.songLibrary.querySelectorAll("[data-pick-song]").forEach((select) => {
    select.addEventListener("change", () => {
      const player = state.players.find((item) => item.id === select.value);
      if (player && !player.picks.includes(select.dataset.pickSong)) player.picks.push(select.dataset.pickSong);
      select.value = "";
      saveState();
      render();
    });
  });

  els.songLibrary.querySelectorAll("[data-song-info]").forEach((button) => {
    button.addEventListener("click", () => {
      const songId = button.dataset.songInfo;
      const selectedPlayers = state.players.filter((player) => player.picks.includes(songId));
      if (selectedPlayers.length === state.players.length) {
        state.players.forEach((player) => {
          player.picks = player.picks.filter((pick) => pick !== songId);
        });
      } else {
        state.players.forEach((player) => {
          if (!player.picks.includes(songId)) player.picks.push(songId);
        });
      }
      saveState();
      render();
    });
  });
}

function renderDeck() {
  const deck = buildDeck();
  if (!deck.length) {
    els.roundDeck.innerHTML = emptyMarkup("Deck leer", "Songs pro Spieler wählen oder Spotify importieren");
    return;
  }
  els.roundDeck.innerHTML = deck.map((item) => {
    const track = getSong(item.songId);
    return `
      <div class="deck-row" style="--cover: ${coverCss(track.cover)}">
        <div class="mini-cover"></div>
        <div>
          <h3>${escapeHtml(track.title)}</h3>
          <p>${escapeHtml(track.artist)} · ${escapeHtml(item.owners.join(", "))}</p>
        </div>
      </div>
    `;
  }).join("");
}

function buildDeck() {
  const alreadyMatched = new Set(state.playlist);
  const bySong = new Map();
  state.players.forEach((player) => {
    player.picks.forEach((songId) => {
      if (alreadyMatched.has(songId)) return;
      if (!bySong.has(songId)) bySong.set(songId, { songId, owners: [] });
      bySong.get(songId).owners.push(player.name);
    });
  });
  return Array.from(bySong.values());
}

function startRound() {
  const deck = buildDeck();
  if (!state.players.length || !deck.length) return;
  state.deck = shuffle(deck);
  state.currentIndex = 0;
  state.votes = {};
  state.rounds += 1;
  saveState();
  showView("swipe");
}

function renderSwipe() {
  if (!state.deck.length || state.currentIndex >= state.deck.length) {
    els.swipeStage.innerHTML = emptyMarkup("Runde fertig", "Matches sind in der Playlist");
    return;
  }

  const item = state.deck[state.currentIndex];
  const track = getSong(item.songId);
  const songVotes = state.votes[track.id] || {};
  const nextPlayer = state.players.find((player) => !songVotes[player.id]);
  const player = track.embedUrl
    ? `<iframe class="spotify-embed" src="${track.embedUrl}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`
    : `<audio controls preload="none" src="${track.preview}"></audio>`;

  els.swipeStage.innerHTML = `
    <article class="swipe-card" style="--cover: ${coverCss(track.cover)}">
      <div class="swipe-cover" aria-hidden="true"></div>
      <div class="swipe-body">
        <div class="swipe-title">
          <div>
            <h2>${escapeHtml(track.title)}</h2>
            <p class="artist">${escapeHtml(track.artist)}</p>
          </div>
          <span class="tag">${state.currentIndex + 1} / ${state.deck.length}</span>
        </div>
        ${player}
        <div class="vote-grid">
          ${state.players.map((person) => {
            const vote = songVotes[person.id];
            return `<div class="vote-pill ${vote || ""}"><strong>${escapeHtml(person.name)}</strong><span>${voteLabel(vote, nextPlayer?.id === person.id)}</span></div>`;
          }).join("")}
        </div>
        <div class="swipe-actions">
          <button class="nope" type="button" data-vote="no">Nein</button>
          <button class="like" type="button" data-vote="yes">Ja</button>
        </div>
      </div>
    </article>
  `;

  els.swipeStage.querySelectorAll("[data-vote]").forEach((button) => {
    button.addEventListener("click", () => castVote(track.id, button.dataset.vote));
  });
}

function castVote(songId, vote) {
  const songVotes = state.votes[songId] || {};
  const nextPlayer = state.players.find((player) => !songVotes[player.id]);
  if (!nextPlayer) return;
  songVotes[nextPlayer.id] = vote;
  state.votes[songId] = songVotes;

  if (state.players.every((player) => songVotes[player.id])) {
    const matched = state.players.every((player) => songVotes[player.id] === "yes");
    if (matched && !state.playlist.includes(songId)) state.playlist.push(songId);
    state.currentIndex += 1;
  }
  saveState();
  render();
}

function renderPlaylist() {
  els.playlistMeta.textContent = state.playlist.length
    ? `${state.playlist.length} Songs · ${state.rounds} Runden`
    : "Noch keine Matches";
  els.playlistLink.innerHTML = state.playlistUrl
    ? `Spotify-Link: <a href="${state.playlistUrl}" target="_blank" rel="noreferrer">${state.playlistUrl}</a>`
    : "";

  if (!state.playlist.length) {
    els.playlist.innerHTML = emptyMarkup("Playlist leer", "Einstimmige Likes landen hier");
    return;
  }

  els.playlist.innerHTML = state.playlist.map((songId, index) => {
    const track = getSong(songId);
    const owners = state.players.filter((player) => player.picks.includes(songId)).map((player) => player.name);
    const player = track.embedUrl
      ? `<iframe class="spotify-embed" src="${track.embedUrl}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`
      : `<audio controls preload="none" src="${track.preview}"></audio>`;
    return `
      <article class="playlist-item" style="--cover: ${coverCss(track.cover)}">
        <div class="playlist-cover"></div>
        <div class="playlist-body">
          <h3>${index + 1}. ${escapeHtml(track.title)}</h3>
          <p class="artist">${escapeHtml(track.artist)}</p>
          <p class="source">${escapeHtml(owners.join(", ") || "Soundmatch")}</p>
        </div>
        ${player}
      </article>
    `;
  }).join("");
}

async function loginSpotify() {
  const clientId = getClientId();
  if (!clientId) return alert("Bitte zuerst deine Spotify Client ID eintragen.");
  localStorage.setItem("soundmatch-client-id", clientId);
  const verifier = randomString(64);
  const challenge = await codeChallenge(verifier);
  const stateValue = randomString(16);
  sessionStorage.setItem("soundmatch-code-verifier", verifier);
  sessionStorage.setItem("soundmatch-oauth-state", stateValue);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri(),
    state: stateValue,
    code_challenge_method: "S256",
    code_challenge: challenge,
    show_dialog: "true",
  });
  location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleSpotifyCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) alert(`Spotify Login fehlgeschlagen: ${error}`);
  if (!code) return;
  if (url.searchParams.get("state") !== sessionStorage.getItem("soundmatch-oauth-state")) {
    alert("Spotify Login abgebrochen: State passt nicht.");
    return;
  }
  const clientId = getClientId();
  const verifier = sessionStorage.getItem("soundmatch-code-verifier");
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const token = await spotifyTokenRequest(body);
  saveToken({ ...token, expires_at: Date.now() + token.expires_in * 1000 });
  sessionStorage.removeItem("soundmatch-code-verifier");
  sessionStorage.removeItem("soundmatch-oauth-state");
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

async function initSpotifyProfile() {
  if (!spotifyToken) return;
  try {
    spotifyProfile = await spotifyApi("/me");
  } catch {
    logoutSpotify(false);
  }
}

async function importSpotifyTopTracks() {
  if (!spotifyToken) return alert("Bitte zuerst mit Spotify anmelden.");
  spotifyProfile = spotifyProfile || await spotifyApi("/me");
  const top = await spotifyApi("/me/top/tracks?limit=20&time_range=medium_term");
  const imported = top.items.map(fromSpotifyTrack);
  const playerName = spotifyProfile.display_name || spotifyProfile.id;
  const existingPlayer = state.players.find((player) => player.spotifyId === spotifyProfile.id);
  const player = existingPlayer || { id: crypto.randomUUID(), name: playerName, picks: [], spotifyId: spotifyProfile.id };
  player.name = playerName;
  player.picks = imported.map((track) => track.id);
  if (!existingPlayer) state.players.push(player);

  const byId = new Map(state.spotifySongs.map((track) => [track.id, track]));
  imported.forEach((track) => byId.set(track.id, track));
  state.spotifySongs = Array.from(byId.values());
  saveState();
  render();
  showView("setup");
}

async function createSpotifyPlaylist() {
  if (!spotifyToken) return alert("Bitte zuerst mit Spotify anmelden.");
  const uris = state.playlist.map(getSong).filter((track) => track.uri).map((track) => track.uri);
  if (!uris.length) return alert("In der Playlist sind noch keine Spotify-Songs.");
  spotifyProfile = spotifyProfile || await spotifyApi("/me");
  const playlist = await spotifyApi(`/users/${encodeURIComponent(spotifyProfile.id)}/playlists`, {
    method: "POST",
    body: JSON.stringify({
      name: `Soundmatch ${state.lobbyCode}`,
      description: "Gemeinsame Soundmatch Playlist aus einstimmigen Swipes.",
      public: true,
    }),
  });
  await spotifyApi(`/playlists/${playlist.id}/tracks`, {
    method: "POST",
    body: JSON.stringify({ uris }),
  });
  state.playlistUrl = playlist.external_urls.spotify;
  saveState();
  render();
  window.open(state.playlistUrl, "_blank", "noopener,noreferrer");
}

async function spotifyApi(path, options = {}) {
  const token = await getValidAccessToken();
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? null : response.json();
}

async function getValidAccessToken() {
  if (!spotifyToken) throw new Error("No Spotify token");
  if (Date.now() < spotifyToken.expires_at - 60000) return spotifyToken.access_token;
  if (!spotifyToken.refresh_token) throw new Error("No refresh token");
  const body = new URLSearchParams({
    client_id: getClientId(),
    grant_type: "refresh_token",
    refresh_token: spotifyToken.refresh_token,
  });
  const refreshed = await spotifyTokenRequest(body);
  saveToken({
    ...spotifyToken,
    ...refreshed,
    refresh_token: refreshed.refresh_token || spotifyToken.refresh_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
  });
  return spotifyToken.access_token;
}

async function spotifyTokenRequest(body) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function fromSpotifyTrack(track) {
  const image = track.album?.images?.[0]?.url || "";
  return {
    id: `spotify-${track.id}`,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(", "),
    ownerHint: "Spotify",
    cover: image,
    preview: track.preview_url || "",
    uri: track.uri,
    spotifyUrl: track.external_urls.spotify,
    embedUrl: `https://open.spotify.com/embed/track/${track.id}?utm_source=generator`,
  };
}

function getClientId() {
  return els.clientIdInput.value.trim() || localStorage.getItem("soundmatch-client-id") || "";
}

function redirectUri() {
  return `${location.origin}${location.pathname}`;
}

function logoutSpotify(refresh = true) {
  localStorage.removeItem("soundmatch-token");
  spotifyToken = null;
  spotifyProfile = null;
  if (refresh) render();
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

async function codeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function voteLabel(vote, active) {
  if (vote === "yes") return "Ja";
  if (vote === "no") return "Nein";
  return active ? "dran" : "offen";
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function emptyMarkup(title, text) {
  const template = document.querySelector("#emptyTemplate").content.cloneNode(true);
  template.querySelector("h3").textContent = title;
  template.querySelector("p").textContent = text;
  const wrapper = document.createElement("div");
  wrapper.append(template);
  return wrapper.innerHTML;
}

function coverCss(value) {
  if (!value) return "linear-gradient(135deg, #20232a, #46c2d9)";
  if (value.startsWith("http")) return `url('${value.replaceAll("'", "%27")}')`;
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
