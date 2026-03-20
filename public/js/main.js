// main.js — App orchestration: shared state init, callbacks, stats panels, event listeners.
import { renderGanttChart, updateGanttSelection } from './gantt.js'
import { renderGraph, updateGraphSelection } from './graph.js';
import { setActiveView } from './state.js';
import { fetchDataAndRender } from './api.js';
import { appState } from './store.js';
import { addEpic, initSearchListeners } from './search.js';
import { loadDevelopers, persistAndRerenderDevList, renderEstimationView } from './developers.js';

// --- DOM Elements ---
const velocityToggle = document.getElementById('velocity-toggle');
const visualizeBtn = document.getElementById('visualize-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const showGraphBtn = document.getElementById('show-graph-btn');
const showGanttBtn = document.getElementById('show-gantt-btn');
const showEstimateBtn = document.getElementById('show-estimate-btn');
const graphContainer = document.getElementById('graph-container');
const ganttContainer = document.getElementById('gantt-container');
const estimateContainer = document.getElementById('estimate-container');
const loader = document.getElementById('loader');
const placeholder = document.getElementById('placeholder');
const issueDetailsPanel = document.getElementById('issue-details');
const epicHeader = document.getElementById('epic-header');
const epicTitle = document.getElementById('epic-title');
const epicSummary = document.getElementById('epic-summary');
const epicStatsContainer = document.getElementById('epic-stats-container');
const epicPercentComplete = document.getElementById('epic-percent-complete');
const epicPointsSummary = document.getElementById('epic-points-summary');
const estimateBtn = document.getElementById('estimate-btn');
const refreshDevsBtn = document.getElementById('refresh-devs-btn');
const skillToggle = document.getElementById('skill-toggle');
const ganttFilterCheckbox = document.getElementById('gantt-filter-completed');

// --- Callbacks (passed into graph/api rendering functions) ---
function handleCurrentGraphData(data) {
    appState.currentGraphData = data;
    updateEpicStats();
}

function handleNodeSelect(nodeId) {
    appState.selectedNodeId = nodeId;
    updateGraphSelection(appState.currentGraphData, appState.selectedNodeId);
    updateIssueDetailsPanel(appState.selectedNodeId, appState.currentGraphData, appState.jiraUrl);
    updateGanttSelection(appState.selectedNodeId);
}

function handleSimulation(sim) { appState.simulation = sim; }
function handleZoom(z) { appState.zoom = z; }

// --- Epic Stats Panel ---
function updateEpicStats() {
    if (!appState.currentGraphData || !appState.currentGraphData.nodes) {
        epicStatsContainer.classList.add('hidden');
        return;
    }

    const allPointedIssues = appState.currentGraphData.nodes.filter(n => n.storyPoints > 0);
    const completedPointedIssues = allPointedIssues.filter(n => n.statusCategory === "Done");

    const totalPoints = allPointedIssues.reduce((sum, n) => sum + n.storyPoints, 0);
    const completedPoints = completedPointedIssues.reduce((sum, n) => sum + n.storyPoints, 0);
    const percentComplete = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;

    epicPercentComplete.textContent = `${percentComplete.toFixed(0)}% Complete`;
    epicPointsSummary.textContent = `${completedPoints} / ${totalPoints} points`;

    const epicUnpointedSummary = document.getElementById('epic-unpointed-summary');
    const unpointedCount = appState.currentGraphData.nodes.filter(n => n.storyPoints === null).length;
    epicUnpointedSummary.textContent = unpointedCount > 0
        ? `(${unpointedCount} unpointed ${unpointedCount === 1 ? 'issue' : 'issues'})`
        : '';

    const epicSkillBreakdown = document.getElementById('epic-skill-breakdown');
    const sumPointsBySkill = (issues) => issues.reduce((acc, issue) => {
        acc[issue.skill] = (acc[issue.skill] || 0) + issue.storyPoints;
        return acc;
    }, {});

    const totalSkillPoints = sumPointsBySkill(allPointedIssues);
    const completedSkillPoints = sumPointsBySkill(completedPointedIssues);
    const skillDisplayNames = { frontend: 'Frontend', backend: 'Backend', fullstack: 'Fullstack', unskilled: 'General' };
    const breakdownParts = [];

    ['frontend', 'backend', 'fullstack', 'unskilled'].forEach(skill => {
        if (totalSkillPoints[skill] > 0) {
            const completed = completedSkillPoints[skill] || 0;
            const total = totalSkillPoints[skill];
            breakdownParts.push(`
                <div class="text-right">
                    <div class="text-xs font-semibold text-gray-700">${skillDisplayNames[skill]}: ${((completed / total) * 100).toFixed(0)}%</div>
                    <div class="text-xs text-gray-500">${completed}/${total} pts</div>
                </div>
            `);
        }
    });

    epicSkillBreakdown.innerHTML = breakdownParts.length > 0
        ? `<div class="flex justify-end space-x-4">${breakdownParts.join('')}</div>`
        : '';

    epicStatsContainer.classList.remove('hidden');
}

// --- Issue Details Panel ---
function updateIssueDetailsPanel(nodeId, graphData, jiraUrl) {
    if (!nodeId || !graphData) { issueDetailsPanel.classList.add('hidden'); return; }

    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) { issueDetailsPanel.classList.add('hidden'); return; }

    document.getElementById('detail-key').textContent = node.id;
    document.getElementById('detail-key').href = `${jiraUrl}/browse/${node.id}`;
    document.getElementById('detail-summary').textContent = node.summary;
    document.getElementById('detail-assignee').textContent = node.assignee;
    document.getElementById('detail-points').textContent = node.storyPoints || '0';
    document.getElementById('detail-link').href = `${jiraUrl}/browse/${node.id}`;

    const badge = document.getElementById('detail-status-badge');
    badge.textContent = node.status;
    badge.className = `status-badge ${node.statusCategory.toLowerCase()}`;

    const skillText = node.skill === 'unskilled' ? 'General' : node.skill;
    document.getElementById('detail-skill').textContent = skillText.charAt(0).toUpperCase() + skillText.slice(1);

    const relatedLinks = graphData.links.filter(link => link.source.id === nodeId || link.target.id === nodeId);
    const linksList = document.getElementById('detail-links');

    if (relatedLinks.length > 0) {
        linksList.innerHTML = relatedLinks.map(link => {
            let text = '';
            if (link.source.id === nodeId) {
                text = `${link.type} <a href="${jiraUrl}/browse/${link.target.id}" target="_blank" class="text-indigo-600 hover:underline">${link.target.id}</a>`;
            } else {
                let inwardType = `is related to`;
                if (link.type.toLowerCase() === 'blocks') inwardType = 'is blocked by';
                if (link.type.toLowerCase() === 'clones') inwardType = 'is cloned by';
                text = `${inwardType} <a href="${jiraUrl}/browse/${link.source.id}" target="_blank" class="text-indigo-600 hover:underline">${link.source.id}</a>`;
            }
            return `<li>${text}</li>`;
        }).join('');
    } else {
        linksList.innerHTML = '<li>None</li>';
    }

    issueDetailsPanel.classList.remove('hidden');
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    const authSection = document.getElementById('auth-section');
    const configForm = document.getElementById('config-form');
    const jiraInstanceLink = document.getElementById('jira-instance-link');

    try {
        const res = await fetch('/api/auth/status');
        const { authenticated, instanceUrl } = await res.json();

        if (authenticated) {
            appState.jiraUrl = instanceUrl;
            authSection.classList.add('hidden');
            configForm.classList.remove('hidden');
            jiraInstanceLink.textContent = instanceUrl.replace('https://', '');
            jiraInstanceLink.href = instanceUrl;

            const savedConfig = JSON.parse(localStorage.getItem('jiraConfig') || '{}');
            if (savedConfig.epicKeys?.length) {
                savedConfig.epicKeys.forEach(e => addEpic(e));
            }
            await loadDevelopers();
        } else {
            authSection.classList.remove('hidden');
            configForm.classList.add('hidden');
        }
    } catch (e) {
        console.error("Could not check auth status", e);
        authSection.classList.remove('hidden');
        configForm.classList.add('hidden');
    }

    initSearchListeners();
});

// --- Visualize ---
visualizeBtn.addEventListener('click', async () => {
    let dataSource;

    if (appState.currentMode === 'sprint') {
        if (!appState.selectedSprint) {
            alert('Please select a sprint.');
            return;
        }
        dataSource = {
            mode: 'sprint',
            sprintId: appState.selectedSprint.id,
            sprintName: appState.selectedSprint.name,
            sprintStartDate: appState.selectedSprint.startDate,
            sprintEndDate: appState.selectedSprint.endDate
        };
    } else {
        if (!appState.selectedEpics.length) {
            alert('Please select at least one epic.');
            return;
        }
        localStorage.setItem('jiraConfig', JSON.stringify({ epicKeys: appState.selectedEpics }));
        dataSource = { mode: 'epic', epicKeys: appState.selectedEpics.map(e => e.key) };
    }

    await loadDevelopers();

    const graph = await fetchDataAndRender(
        appState.jiraUrl, dataSource,
        handleNodeSelect, appState.selectedNodeId, handleSimulation, appState.simulation,
        handleZoom, appState.zoom, graphContainer, ganttContainer, estimateContainer,
        loader, placeholder, issueDetailsPanel, epicHeader, epicTitle,
        epicSummary, resetViewBtn, showGraphBtn, showGanttBtn, showEstimateBtn
    );
    handleCurrentGraphData(graph);
});

// --- Developer Controls ---
refreshDevsBtn.addEventListener('click', loadDevelopers);
estimateBtn.addEventListener('click', renderEstimationView);

skillToggle.addEventListener('change', () => {
    persistAndRerenderDevList();
    renderEstimationView();
});

velocityToggle.addEventListener('change', () => {
    persistAndRerenderDevList();
});

// --- View Controls ---
resetViewBtn.addEventListener('click', () => {
    if (appState.currentGraphData) {
        appState.currentGraphData.nodes.forEach(node => {
            delete node.x; delete node.y;
            delete node.vx; delete node.vy;
            delete node.fx; delete node.fy;
        });
        renderGraph(appState.currentGraphData, appState.selectedNodeId, graphContainer, handleNodeSelect, appState.simulation, handleSimulation, appState.zoom, handleZoom);
    }
});

window.addEventListener('resize', () => {
    if (appState.currentGraphData) {
        renderGraph(appState.currentGraphData, appState.selectedNodeId, graphContainer, handleNodeSelect, appState.simulation, handleSimulation, appState.zoom, handleZoom);
        updateGraphSelection(appState.currentGraphData, appState.selectedNodeId);
    }
});

showGraphBtn.addEventListener('click', () => {
    setActiveView('graph', graphContainer, ganttContainer, estimateContainer, showGraphBtn, showGanttBtn, showEstimateBtn);
    if (appState.currentGraphData) {
        renderGraph(appState.currentGraphData, appState.selectedNodeId, graphContainer, handleNodeSelect, appState.simulation, handleSimulation, appState.zoom, handleZoom);
        updateGraphSelection(appState.currentGraphData, appState.selectedNodeId);
    }
});

showGanttBtn.addEventListener('click', () => {
    setActiveView('gantt', graphContainer, ganttContainer, estimateContainer, showGraphBtn, showGanttBtn, showEstimateBtn);
    if (appState.currentGraphData) {
        renderGanttChart(appState.currentGraphData, appState.jiraUrl, handleNodeSelect, appState.selectedNodeId);
    }
});

showEstimateBtn.addEventListener('click', () => {
    setActiveView('estimate', graphContainer, ganttContainer, estimateContainer, showGraphBtn, showGanttBtn, showEstimateBtn);
    renderEstimationView();
});

ganttFilterCheckbox.addEventListener('change', () => {
    if (appState.currentGraphData && !ganttContainer.classList.contains('hidden')) {
        renderGanttChart(appState.currentGraphData, appState.jiraUrl, handleNodeSelect, appState.selectedNodeId);
    }
});
