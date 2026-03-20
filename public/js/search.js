// search.js — Epic/board/sprint search UI and mode toggle logic.
import { appState } from './store.js';

let searchDebounceTimer = null;

// --- Mode Toggle ---
export function setMode(mode) {
    appState.currentMode = mode;
    const epicSection = document.getElementById('epic-section');
    const sprintSection = document.getElementById('sprint-section');
    const modeEpicBtn = document.getElementById('mode-epic-btn');
    const modeSprintBtn = document.getElementById('mode-sprint-btn');

    if (mode === 'sprint') {
        epicSection.classList.add('hidden');
        sprintSection.classList.remove('hidden');
        modeSprintBtn.classList.add('bg-indigo-600', 'text-white');
        modeSprintBtn.classList.remove('text-gray-600');
        modeEpicBtn.classList.remove('bg-indigo-600', 'text-white');
        modeEpicBtn.classList.add('text-gray-600');
    } else {
        sprintSection.classList.add('hidden');
        epicSection.classList.remove('hidden');
        modeEpicBtn.classList.add('bg-indigo-600', 'text-white');
        modeEpicBtn.classList.remove('text-gray-600');
        modeSprintBtn.classList.remove('bg-indigo-600', 'text-white');
        modeSprintBtn.classList.add('text-gray-600');
    }
}

// --- Epic Search ---
export function renderSelectedEpics() {
    const container = document.getElementById('selected-epics');
    if (!container) return;
    container.innerHTML = appState.selectedEpics.map(e => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-medium">
            <span class="font-mono">${e.key}</span>
            <button data-key="${e.key}" class="epic-remove ml-1 text-indigo-400 hover:text-indigo-700 leading-none">&times;</button>
        </span>
    `).join('');
    container.querySelectorAll('.epic-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            appState.selectedEpics = appState.selectedEpics.filter(e => e.key !== btn.dataset.key);
            renderSelectedEpics();
        });
    });
}

export function addEpic(epic) {
    if (appState.selectedEpics.some(e => e.key === epic.key)) return;
    appState.selectedEpics.push(epic);
    renderSelectedEpics();
}

export async function searchEpics(q) {
    const dropdown = document.getElementById('epic-dropdown');
    if (q.length < 2) { dropdown.classList.add('hidden'); return; }

    dropdown.innerHTML = '<div class="px-3 py-2 text-gray-400">Searching...</div>';
    dropdown.classList.remove('hidden');

    try {
        const res = await fetch(`/api/search/epics?q=${encodeURIComponent(q)}`);
        const { epics } = await res.json();

        if (!epics || epics.length === 0) {
            dropdown.innerHTML = '<div class="px-3 py-2 text-gray-400">No epics found.</div>';
            return;
        }

        dropdown.innerHTML = epics.map(e => {
            const alreadySelected = appState.selectedEpics.some(s => s.key === e.key);
            return `
                <div data-key="${e.key}" data-summary="${e.summary.replace(/"/g, '&quot;')}" data-project="${e.project}"
                    class="epic-option px-3 py-2 cursor-pointer hover:bg-indigo-50 ${alreadySelected ? 'opacity-40 pointer-events-none' : ''}">
                    <div class="flex items-baseline gap-2">
                        <span class="font-mono text-xs text-indigo-600">${e.key}</span>
                        <span class="text-gray-800 truncate">${e.summary}</span>
                    </div>
                    <div class="text-xs text-gray-400">${e.project}</div>
                </div>
            `;
        }).join('');

        dropdown.querySelectorAll('.epic-option').forEach(el => {
            el.addEventListener('click', () => {
                addEpic({ key: el.dataset.key, summary: el.dataset.summary, project: el.dataset.project });
                document.getElementById('epic-search').value = '';
                dropdown.classList.add('hidden');
            });
        });
    } catch (err) {
        dropdown.innerHTML = '<div class="px-3 py-2 text-red-400">Search failed.</div>';
    }
}

// --- Project Search ---
export async function searchBoards(q) {
    const dropdown = document.getElementById('board-dropdown');
    dropdown.innerHTML = '<div class="px-3 py-2 text-gray-400">Searching...</div>';
    dropdown.classList.remove('hidden');

    try {
        const res = await fetch(`/api/search/projects?q=${encodeURIComponent(q)}`);
        const { projects } = await res.json();

        if (!projects || projects.length === 0) {
            dropdown.innerHTML = '<div class="px-3 py-2 text-gray-400">No projects found.</div>';
            return;
        }

        dropdown.innerHTML = projects.map(p => `
            <div data-key="${p.key}" data-name="${p.name.replace(/"/g, '&quot;')}"
                class="board-option px-3 py-2 cursor-pointer hover:bg-indigo-50">
                <div class="flex items-baseline gap-2">
                    <span class="font-mono text-xs text-indigo-600">${p.key}</span>
                    <span class="text-gray-800">${p.name}</span>
                </div>
            </div>
        `).join('');

        dropdown.querySelectorAll('.board-option').forEach(el => {
            el.addEventListener('click', () => {
                appState.selectedBoard = { id: el.dataset.key, name: el.dataset.name };
                document.getElementById('board-search').value = `${el.dataset.key} — ${el.dataset.name}`;
                dropdown.classList.add('hidden');
                loadSprints(appState.selectedBoard.id);
            });
        });
    } catch (err) {
        dropdown.innerHTML = '<div class="px-3 py-2 text-red-400">Search failed.</div>';
    }
}

export async function loadSprints(projectKey) {
    const select = document.getElementById('sprint-select');
    select.disabled = true;
    select.innerHTML = '<option value="">Loading sprints...</option>';
    appState.selectedSprint = null;

    try {
        const res = await fetch(`/api/search/sprints?projectKey=${projectKey}`);
        const { sprints } = await res.json();

        if (!sprints || sprints.length === 0) {
            select.innerHTML = '<option value="">No active or future sprints found</option>';
            return;
        }

        select.innerHTML = '<option value="">Select a sprint...</option>' + sprints.map(s => {
            const label = s.state === 'active' ? ` (active)` : '';
            return `<option value="${s.id}" data-name="${s.name.replace(/"/g, '&quot;')}" data-state="${s.state}" data-start="${s.startDate || ''}" data-end="${s.endDate || ''}">${s.name}${label}</option>`;
        }).join('');
        select.disabled = false;
    } catch (err) {
        select.innerHTML = '<option value="">Failed to load sprints</option>';
    }
}

// --- Event Listeners ---
export function initSearchListeners() {
    document.getElementById('mode-epic-btn')?.addEventListener('click', () => setMode('epic'));
    document.getElementById('mode-sprint-btn')?.addEventListener('click', () => setMode('sprint'));

    document.getElementById('epic-search')?.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => searchEpics(e.target.value.trim()), 300);
    });

    document.getElementById('board-search')?.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        const q = e.target.value.trim();
        if (q.length < 2) {
            document.getElementById('board-dropdown')?.classList.add('hidden');
            return;
        }
        searchDebounceTimer = setTimeout(() => searchBoards(q), 300);
    });

    document.getElementById('sprint-select')?.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        if (!opt || !opt.value) { appState.selectedSprint = null; return; }
        appState.selectedSprint = {
            id: Number(opt.value),
            name: opt.dataset.name,
            state: opt.dataset.state,
            startDate: opt.dataset.start || null,
            endDate: opt.dataset.end || null
        };
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#epic-search') && !e.target.closest('#epic-dropdown')) {
            document.getElementById('epic-dropdown')?.classList.add('hidden');
        }
        if (!e.target.closest('#board-search') && !e.target.closest('#board-dropdown')) {
            document.getElementById('board-dropdown')?.classList.add('hidden');
        }
    });
}
