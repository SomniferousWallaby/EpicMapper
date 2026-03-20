// Shared mutable application state — imported by all modules that need it.
export const appState = {
    jiraUrl: null,
    currentGraphData: null,
    selectedNodeId: null,
    simulation: null,
    zoom: null,
    devs: [],
    savedDevStates: {},
    selectedEpics: [],   // [{ key, summary, project }]
    currentMode: 'epic', // 'epic' | 'sprint'
    selectedBoard: null, // { id, name }
    selectedSprint: null // { id, name, state, startDate, endDate }
};
