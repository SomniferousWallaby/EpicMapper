// developers.js — Developer data fetching, list rendering, and sprint/epic estimation.
import { appState } from './store.js';

export async function fetchDevelopers() {
    try {
        const response = await fetch('/api/developers', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
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

export function renderDeveloperList(devList) {
    const devListContainer = document.getElementById('developer-list-container');
    if (!devListContainer) return;

    if (devList.length === 0) {
        devListContainer.innerHTML = `<p class="text-gray-500 text-center">No developer data found.</p>`;
        return;
    }

    const adminControls = document.getElementById('admin-controls');
    const isUserAdmin = adminControls && !adminControls.classList.contains('hidden');
    const useSkillBasedMode = document.getElementById('skill-toggle').checked;

    devListContainer.innerHTML = devList.map(dev => {
        const hasVelocity = dev.velocity !== undefined;
        const showVelocity = isUserAdmin && document.getElementById('velocity-toggle')?.checked;
        const totalVeloText = showVelocity ? `(${(dev.velocity / 4.3).toFixed(1)} total pts/wk)` : '';

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

export function persistAndRerenderDevList() {
    appState.devs.forEach(dev => {
        if (!appState.savedDevStates[dev.accountId]) {
            appState.savedDevStates[dev.accountId] = { isIncluded: false, allocation: '100', isFe: false, isBe: false };
        }
        const state = appState.savedDevStates[dev.accountId];

        const masterCheckbox = document.getElementById(`dev-include-${dev.accountId}`);
        const allocationInput = document.querySelector(`input[data-allocation-id="${dev.accountId}"]`);
        if (masterCheckbox) state.isIncluded = masterCheckbox.checked;
        if (allocationInput) state.allocation = allocationInput.value;

        const feCheckbox = document.getElementById(`fe-skill-${dev.accountId}`);
        const beCheckbox = document.getElementById(`be-skill-${dev.accountId}`);
        if (feCheckbox) state.isFe = feCheckbox.checked;
        if (beCheckbox) state.isBe = beCheckbox.checked;
    });

    renderDeveloperList(appState.devs);

    for (const accountId in appState.savedDevStates) {
        const state = appState.savedDevStates[accountId];
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

export async function loadDevelopers() {
    appState.savedDevStates = {};
    const { developers, isUserAdmin } = await fetchDevelopers();
    appState.devs = developers;
    appState.devs.sort((a, b) => a.name.localeCompare(b.name));

    const adminControls = document.getElementById('admin-controls');
    if (isUserAdmin) {
        adminControls.classList.remove('hidden');
        adminControls.classList.add('flex');
    } else {
        adminControls.classList.add('hidden');
        adminControls.classList.remove('flex');
    }

    renderDeveloperList(appState.devs);
}

export function renderEstimationView() {
    const estimateOutput = document.getElementById('estimate-output');
    if (!appState.currentGraphData || !appState.currentGraphData.nodes) {
        estimateOutput.innerHTML = `<span class="text-gray-500">Graph data not loaded.</span>`;
        return;
    }

    const useSkillBasedMode = document.getElementById('skill-toggle').checked;
    const remainingIssues = appState.currentGraphData.nodes.filter(n => n.statusCategory !== "Done");
    const unpointedCount = remainingIssues.filter(n => n.storyPoints === null).length;

    let totalSelectedVelocity = 0;
    appState.devs.forEach(dev => {
        const isIncluded = document.getElementById(`dev-include-${dev.accountId}`)?.checked;
        if (!isIncluded || dev.velocity === undefined) return;
        const allocationInput = document.querySelector(`input[data-allocation-id="${dev.accountId}"]`);
        const allocation = (Number(allocationInput.value) || 100) / 100;
        totalSelectedVelocity += (dev.velocity / 4.3) * allocation;
    });

    if (totalSelectedVelocity === 0 && appState.devs.some(d => d.velocity !== undefined)) {
        estimateOutput.innerHTML = `<span class="text-gray-500">Please include at least one developer in the estimate</span>`;
        return;
    }

    // --- SIMPLE MODE ---
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

    // --- SKILL-BASED MODE ---
    const fePoints = remainingIssues.filter(n => n.skill === 'frontend').reduce((sum, n) => sum + (n.storyPoints || 0), 0);
    const bePoints = remainingIssues.filter(n => n.skill === 'backend').reduce((sum, n) => sum + (n.storyPoints || 0), 0);
    const fsPoints = remainingIssues.filter(n => n.skill === 'fullstack').reduce((sum, n) => sum + (n.storyPoints || 0), 0);
    const generalPoints = remainingIssues.filter(n => n.skill === 'unskilled').reduce((sum, n) => sum + (n.storyPoints || 0), 0);

    let feVeloPool = 0, beVeloPool = 0, fsVeloPool = 0;
    appState.devs.forEach(dev => {
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
