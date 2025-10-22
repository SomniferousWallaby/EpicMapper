// main.js
import { renderGanttChart, updateGanttSelection } from './gantt.js'
import { renderGraph, updateGraphSelection } from './graph.js';
import { setActiveView } from './state.js';
import { fetchDataAndRender } from './api.js';

// --- DOM Elements ---
const adminControls = document.getElementById('admin-controls');
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
const estimateOutput = document.getElementById('estimate-output');
const devListContainer = document.getElementById('developer-list-container');
const refreshDevsBtn = document.getElementById('refresh-devs-btn');
const skillToggle = document.getElementById('skill-toggle');
const ganttFilterCheckbox = document.getElementById('gantt-filter-completed');

// --- Global Variables ---
let JIRA_URL, EMAIL, API_TOKEN, EPIC_KEY;
let currentGraphData = null;
let selectedNodeId = null;
let simulation = null;
let zoom = null;
let devs = [];
let savedDevStates = {};

// --- Callback Functions ---
function handleCurrentGraphData(data) { 
    currentGraphData = data; 
    updateEpicStats();
}
function handleNodeSelect(nodeId) { 
    selectedNodeId = nodeId; 
    updateGraphSelection(currentGraphData, selectedNodeId);
    updateIssueDetailsPanel(selectedNodeId, currentGraphData, JIRA_URL);
    updateGanttSelection(selectedNodeId);
}

function handleSimulation(sim) { simulation = sim; }

function handleZoom(z) { zoom = z; }

function updateEpicStats() {
    if (!currentGraphData || !currentGraphData.nodes) {
        epicStatsContainer.classList.add('hidden');
        return;
    }

    // --- Overall Progress Calculation ---
    const allPointedIssues = currentGraphData.nodes.filter(n => n.storyPoints > 0);
    const completedPointedIssues = allPointedIssues.filter(n => n.statusCategory === "Done");

    const totalPoints = allPointedIssues.reduce((sum, n) => sum + n.storyPoints, 0);
    const completedPoints = completedPointedIssues.reduce((sum, n) => sum + n.storyPoints, 0);
    const percentComplete = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;

    epicPercentComplete.textContent = `${percentComplete.toFixed(0)}% Complete`;
    epicPointsSummary.textContent = `${completedPoints} / ${totalPoints} points`;

    // --- Unpointed Issues Calculation ---
    const epicUnpointedSummary = document.getElementById('epic-unpointed-summary');
    const unpointedCount = currentGraphData.nodes.filter(n => n.storyPoints === null).length;

    if (unpointedCount > 0) {
        const plural = unpointedCount === 1 ? 'issue' : 'issues';
        epicUnpointedSummary.textContent = `(${unpointedCount} unpointed ${plural})`;
    } else {
        epicUnpointedSummary.textContent = '';
    }

    // --- Skill-Based Progress Calculation and Rendering ---
    const epicSkillBreakdown = document.getElementById('epic-skill-breakdown');
    
    const sumPointsBySkill = (issues) => {
        return issues.reduce((acc, issue) => {
            acc[issue.skill] = (acc[issue.skill] || 0) + issue.storyPoints;
            return acc;
        }, {});
    };

    const totalSkillPoints = sumPointsBySkill(allPointedIssues);
    const completedSkillPoints = sumPointsBySkill(completedPointedIssues);
    const breakdownParts = [];
    const skillOrder = ['frontend', 'backend', 'fullstack', 'unskilled'];
    const skillDisplayNames = {
        frontend: 'Frontend',
        backend: 'Backend',
        fullstack: 'Fullstack',
        unskilled: 'General'
    };

    skillOrder.forEach(skill => {
        if (totalSkillPoints[skill] > 0) {
            const completed = completedSkillPoints[skill] || 0;
            const total = totalSkillPoints[skill];
            const skillPercent = (completed / total) * 100;
            const displayName = skillDisplayNames[skill] || skill;

            const skillHtml = `
                <div class="text-right">
                    <div class="text-xs font-semibold text-gray-700">${displayName}: ${skillPercent.toFixed(0)}%</div>
                    <div class="text-xs text-gray-500">${completed}/${total} pts</div>
                </div>
            `;
            breakdownParts.push(skillHtml);
        }
    });

    if (breakdownParts.length > 0) {
        epicSkillBreakdown.innerHTML = `<div class="flex justify-end space-x-4">${breakdownParts.join('')}</div>`;
    } else {
        epicSkillBreakdown.innerHTML = '';
    }

    epicStatsContainer.classList.remove('hidden');
}

function updateIssueDetailsPanel(nodeId, graphData, jiraUrl) {
    const issueDetailsPanel = document.getElementById('issue-details');
    const detailKey = document.getElementById('detail-key');
    const detailSummary = document.getElementById('detail-summary');
    const detailStatusBadge = document.getElementById('detail-status-badge');
    const detailAssignee = document.getElementById('detail-assignee');
    const detailPoints = document.getElementById('detail-points');
    const detailSkill = document.getElementById('detail-skill');
    const detailLinksList = document.getElementById('detail-links');
    const detailLink = document.getElementById('detail-link');

    if (!nodeId || !graphData) {
        issueDetailsPanel.classList.add('hidden');
        return;
    }

    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) {
        issueDetailsPanel.classList.add('hidden');
        return;
    }

    detailKey.textContent = node.id;
    detailKey.href = `${jiraUrl}/browse/${node.id}`;
    detailSummary.textContent = node.summary;
    detailAssignee.textContent = node.assignee;
    detailPoints.textContent = node.storyPoints || '0';
    detailLink.href = `${jiraUrl}/browse/${node.id}`;

    detailStatusBadge.textContent = node.status;
    detailStatusBadge.className = `status-badge ${node.statusCategory.toLowerCase()}`;
    
    const skillText = (node.skill === 'unskilled' ? 'General' : node.skill);
    detailSkill.textContent = skillText.charAt(0).toUpperCase() + skillText.slice(1);

    const relatedLinks = graphData.links.filter(link => link.source.id === nodeId || link.target.id === nodeId);

    if (relatedLinks.length > 0) {
        detailLinksList.innerHTML = relatedLinks.map(link => {
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
        detailLinksList.innerHTML = '<li>None</li>';
    }

    issueDetailsPanel.classList.remove('hidden');
}

// --- Developer Data Functions ---
async function fetchDevelopers() {
    if (!JIRA_URL || !EMAIL || !API_TOKEN) {
        console.warn("Cannot fetch developers, Jira credentials are not set.");
        return { developers: [], isUserAdmin: false }; 
    }
    try {
        const response = await fetch('/api/developers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jiraUrl: JIRA_URL, email: EMAIL, apiToken: API_TOKEN })
        });
        if (!response.ok) {
            console.error('Failed to fetch developers:', response.statusText);
            return { developers: [], isUserAdmin: false };
        }
        return await response.json(); 
    } catch (error) {
        console.error('Error fetching developers:', error);
        return { developers: [], isUserAdmin: false };
    }
}

function persistAndRerenderDevList() {
    devs.forEach(dev => {
        if (!savedDevStates[dev.accountId]) {
            savedDevStates[dev.accountId] = { isIncluded: false, allocation: '100', isFe: false, isBe: false };
        }
        const state = savedDevStates[dev.accountId];

        const masterCheckbox = document.getElementById(`dev-include-${dev.accountId}`);
        const allocationInput = document.querySelector(`input[data-allocation-id="${dev.accountId}"]`);
        if (masterCheckbox) state.isIncluded = masterCheckbox.checked;
        if (allocationInput) state.allocation = allocationInput.value;

        const feCheckbox = document.getElementById(`fe-skill-${dev.accountId}`);
        const beCheckbox = document.getElementById(`be-skill-${dev.accountId}`);
        if (feCheckbox) state.isFe = feCheckbox.checked;
        if (beCheckbox) state.isBe = beCheckbox.checked;
    });
    renderDeveloperList(devs);
    
    for (const accountId in savedDevStates) {
        const state = savedDevStates[accountId];
        
        const newMasterCheckbox = document.getElementById(`dev-include-${accountId}`);
        const newAllocationInput = document.querySelector(`input[data-allocation-id="${accountId}"]`);
        const newFeCheckbox = document.getElementById(`fe-skill-${accountId}`);
        const newBeCheckbox = document.getElementById(`be-skill-${accountId}`);

        if (newMasterCheckbox) newMasterCheckbox.checked = state.isIncluded;
        if (newAllocationInput) newAllocationInput.value = state.allocation;
        if (newFeCheckbox) newFeCheckbox.checked = state.isFe;
        if (newBeCheckbox) newBeCheckbox.checked = state.isBe;
    }
}


function renderDeveloperList(devList) {
    if (!devListContainer) return;
    
    if (devList.length === 0) {
        devListContainer.innerHTML = `<p class="text-gray-500 text-center">No developer data found.</p>`;
        return;
    }

    const useSkillBasedMode = document.getElementById('skill-toggle').checked;

    devListContainer.innerHTML = devList.map(dev => {
        const hasVelocity = dev.velocity !== undefined; 
        const showVelocity = hasVelocity && document.getElementById('velocity-toggle')?.checked;
        const totalVeloText = showVelocity ? `(${(dev.velocity / 4.3).toFixed(1)} total pts/wk)` : '';
        
        
        // This is the skill selection part, which may be hidden
        const skillSelectionHtml = useSkillBasedMode ? `
            <div class="mt-2 pl-8 space-y-1">
                <p class="text-xs font-semibold text-gray-500">Skills:</p>
                <div class="flex items-center">
                    <input type="checkbox" id="fe-skill-${dev.accountId}" data-skill="frontend" data-account-id="${dev.accountId}" class="h-4 w-4 rounded border-gray-300">
                    <label for="fe-skill-${dev.accountId}" class="ml-2 text-sm">Frontend</label>
                </div>
                <div class="flex items-center">
                    <input type="checkbox" id="be-skill-${dev.accountId}" data-skill="backend" data-account-id="${dev.accountId}" class="h-4 w-4 rounded border-gray-300">
                    <label for="be-skill-${dev.accountId}" class="ml-2 text-sm">Backend</label>
                </div>
            </div>
        ` : '';

        return `
            <div class="p-2 rounded-md hover:bg-gray-50 border-b last:border-b-0">
                <div class="flex items-center justify-between">
                    <div class="flex items-center">
                        <input type="checkbox" id="dev-include-${dev.accountId}" data-master-id="${dev.accountId}" class="h-5 w-5 rounded border-gray-300">
                        
                        <label for="dev-include-${dev.accountId}" class="ml-3 cursor-pointer">
                            <div class="font-medium text-sm text-gray-800">${dev.name}</div>
                            ${hasVelocity ? `<div class="text-xs text-gray-500">${totalVeloText.replace(/[()]/g, '')}</div>` : ''}
                        </label>
                        </div>
                    <div class="flex items-center space-x-2">
                        <input type="number" data-allocation-id="${dev.accountId}" value="100" min="0" max="100" class="w-20 text-right border-gray-300 rounded-md shadow-sm sm:text-sm">
                        <span class="text-sm text-gray-500">%</span>
                    </div>
                </div>
                ${skillSelectionHtml}
            </div>
        `;
    }).join('');
}

async function loadDevelopers() {
    savedDevStates = {};
    const { developers, isUserAdmin } = await fetchDevelopers();
    devs = developers; 
    devs.sort((a, b) => a.name.localeCompare(b.name));

    if (isUserAdmin) {
        adminControls.classList.remove('hidden');
        adminControls.classList.add('flex'); 
    } else {
        adminControls.classList.add('hidden');
        adminControls.classList.remove('flex');
    }

    renderDeveloperList(devs);
}

function renderEstimationView() {
    if (!currentGraphData || !currentGraphData.nodes) {
        estimateOutput.innerHTML = `<span class="text-gray-500">Graph data not loaded.</span>`;
        return;
    }
    
    const useSkillBasedMode = document.getElementById('skill-toggle').checked;
    const remainingIssues = currentGraphData.nodes.filter(n => n.statusCategory !== "Done");
    const unpointedCount = remainingIssues.filter(n => n.storyPoints === null).length;

    let totalSelectedVelocity = 0;
    devs.forEach(dev => {
        const isIncluded = document.getElementById(`dev-include-${dev.accountId}`)?.checked;
        if (!isIncluded || dev.velocity === undefined) return;

        const allocationInput = document.querySelector(`input[data-allocation-id="${dev.accountId}"]`);
        const allocation = (Number(allocationInput.value) || 100) / 100;
        totalSelectedVelocity += (dev.velocity / 4.3) * allocation;
    });

    if (totalSelectedVelocity === 0 && devs.some(d => d.velocity !== undefined)) {
         estimateOutput.innerHTML = `<span class="text-gray-500">Please include at least one developer in the estimate</span>`;
         return;
    }

    // --- SIMPLE MODE CALCULATION ---
    if (!useSkillBasedMode) {
        const totalRemainingPoints = remainingIssues.reduce((sum, n) => sum + (n.storyPoints || 0), 0);
        const weeksLeft = totalSelectedVelocity > 0 ? totalRemainingPoints / totalSelectedVelocity : 0;
        
        let output = `Est. Time: <span class="font-black">${weeksLeft.toFixed(1)}</span> weeks (Simple Mode)`;
        if (unpointedCount > 0) {
            output += `<div class="text-sm font-normal text-gray-600">— with ${unpointedCount} incomplete, unpointed issues</div>`;
        }
        estimateOutput.innerHTML = output;
        return;
    }

    // --- SKILL-BASED MODE CALCULATION ---
    const fePoints = remainingIssues.filter(n => n.skill === 'frontend').reduce((sum, n) => sum + (n.storyPoints || 0), 0);
    const bePoints = remainingIssues.filter(n => n.skill === 'backend').reduce((sum, n) => sum + (n.storyPoints || 0), 0);
    const fsPoints = remainingIssues.filter(n => n.skill === 'fullstack').reduce((sum, n) => sum + (n.storyPoints || 0), 0);
    const generalPoints = remainingIssues.filter(n => n.skill === 'unskilled').reduce((sum, n) => sum + (n.storyPoints || 0), 0);

    let feVeloPool = 0, beVeloPool = 0, fsVeloPool = 0;
    devs.forEach(dev => {
        const isIncluded = document.getElementById(`dev-include-${dev.accountId}`)?.checked;
        if (!isIncluded || dev.velocity === undefined) return;

        const isFe = document.getElementById(`fe-skill-${dev.accountId}`)?.checked;
        const isBe = document.getElementById(`be-skill-${dev.accountId}`)?.checked;
        const allocationInput = document.querySelector(`input[data-allocation-id="${dev.accountId}"]`);
        const allocation = (Number(allocationInput.value) || 100) / 100;
        const allocatedVelo = (dev.velocity / 4.3) * allocation;

        if (isFe) feVeloPool += allocatedVelo;
        if (isBe) beVeloPool += allocatedVelo;
        if (isFe && isBe) fsVeloPool += allocatedVelo;
    });

    const feTime = feVeloPool > 0 ? fePoints / feVeloPool : (fePoints > 0 ? Infinity : 0);
    const beTime = beVeloPool > 0 ? bePoints / beVeloPool : (bePoints > 0 ? Infinity : 0);
    const fsTime = fsVeloPool > 0 ? fsPoints / fsVeloPool : (fsPoints > 0 ? Infinity : 0);
    const generalTime = totalSelectedVelocity > 0 ? generalPoints / totalSelectedVelocity : 0;
    const bottleneckWeeks = Math.max(feTime, beTime, fsTime);

    let output = '';
    if (bottleneckWeeks === Infinity) {
        output = `<span class="text-red-500">Warning: No developers assigned to required skills.</span>`;
    } else {
        const totalTime = bottleneckWeeks + generalTime;
        output = `Est. Time: <span class="font-black">${totalTime.toFixed(1)}</span> weeks`;
        output += `<div class="text-sm font-normal mt-1">(FE: ${feTime.toFixed(1)} wks, BE: ${beTime.toFixed(1)} wks, FS: ${fsTime.toFixed(1)} wks, General: ${generalTime.toFixed(1)} wks)</div>`;
        if (unpointedCount > 0) {
            output += `<div class="text-sm font-normal text-gray-600">— with ${unpointedCount} incomplete, unpointed issues</div>`;
        }
    }
    estimateOutput.innerHTML = output;
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const savedConfig = JSON.parse(localStorage.getItem('jiraConfig'));
        if (savedConfig) {
            document.getElementById('jira-url').value = savedConfig.jiraUrl || '';
            document.getElementById('email').value = savedConfig.email || '';
            document.getElementById('epic-key').value = savedConfig.epicKey || '';
            JIRA_URL = savedConfig.jiraUrl;
            EMAIL = savedConfig.email;
            API_TOKEN = document.getElementById('api-token').value.trim();
            if (API_TOKEN) {
                await loadDevelopers();
            }
        }
    } catch (e) { console.error("Could not load config from localStorage", e); }
});

visualizeBtn.addEventListener('click', async () => {
    JIRA_URL = document.getElementById('jira-url').value.trim();
    EMAIL = document.getElementById('email').value.trim();
    API_TOKEN = document.getElementById('api-token').value.trim();
    let epic_key_input = document.getElementById('epic-key').value.trim();
    EPIC_KEY = epic_key_input.split(',').map(k => k.trim()).filter(k => k);

    if (!JIRA_URL || !EMAIL || !API_TOKEN || !EPIC_KEY.length) {
        alert('Please fill in all Jira configuration fields.');
        return;
    }
    if (JIRA_URL.endsWith('/')) { JIRA_URL = JIRA_URL.slice(0, -1); }

    const configToSave = { jiraUrl: JIRA_URL, email: EMAIL, epicKey: epic_key_input };
    localStorage.setItem('jiraConfig', JSON.stringify(configToSave));
    await loadDevelopers();

    const graph = await fetchDataAndRender(
        JIRA_URL, EMAIL, API_TOKEN, EPIC_KEY,
        handleNodeSelect, selectedNodeId, handleSimulation, simulation,
        handleZoom, zoom, graphContainer, ganttContainer, estimateContainer,
        loader, placeholder, issueDetailsPanel, epicHeader, epicTitle,
        epicSummary, resetViewBtn, showGraphBtn, showGanttBtn, showEstimateBtn
    );
    handleCurrentGraphData(graph);
});

refreshDevsBtn.addEventListener('click', loadDevelopers);
estimateBtn.addEventListener('click', renderEstimationView);

skillToggle.addEventListener('change', () => {
    persistAndRerenderDevList();
    renderEstimationView();
});

// --- VIEW LOGIC ---
resetViewBtn.addEventListener('click', () => {
    if (currentGraphData) {
        currentGraphData.nodes.forEach(node => {
            delete node.x;
            delete node.y;
            delete node.vx;
            delete node.vy;
            delete node.fx;
            delete node.fy;
        });

        renderGraph(
            currentGraphData,
            selectedNodeId,
            graphContainer,
            handleNodeSelect,
            simulation,
            handleSimulation,
            zoom,
            handleZoom
        );
    }
});

window.addEventListener('resize', () => {
    if (currentGraphData) {
        renderGraph(
            currentGraphData, selectedNodeId, graphContainer, handleNodeSelect,
            simulation, handleSimulation, zoom, handleZoom
        );
        updateGraphSelection(currentGraphData, selectedNodeId);
    }
});

showGraphBtn.addEventListener('click', () => {
    setActiveView('graph', graphContainer, ganttContainer, estimateContainer, showGraphBtn, showGanttBtn, showEstimateBtn);
    if (currentGraphData) {
        renderGraph(
            currentGraphData,
            selectedNodeId,
            graphContainer,
            handleNodeSelect,
            simulation,
            handleSimulation,
            zoom,
            handleZoom
        );
        updateGraphSelection(currentGraphData, selectedNodeId);
    }
});

showGanttBtn.addEventListener('click', () => {
    setActiveView('gantt', graphContainer, ganttContainer, estimateContainer, showGraphBtn, showGanttBtn, showEstimateBtn);
    if (currentGraphData) {
        renderGanttChart(
            currentGraphData, JIRA_URL, handleNodeSelect,
            selectedNodeId
        );
    }
});

showEstimateBtn.addEventListener('click', () => {
    setActiveView('estimate', graphContainer, ganttContainer, estimateContainer, showGraphBtn, showGanttBtn, showEstimateBtn);
    renderEstimationView();
});

velocityToggle.addEventListener('change', () => {
    persistAndRerenderDevList();
});

ganttFilterCheckbox.addEventListener('change', () => {
    if (currentGraphData && !ganttContainer.classList.contains('hidden')) {
        renderGanttChart(
            currentGraphData,
            JIRA_URL,
            handleNodeSelect,
            selectedNodeId
        );
    }
});