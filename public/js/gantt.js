/**
 * Renders a Gantt chart with rows ordered by dependency trees.
 */

import { statusColors, epicPalette } from "./colors.js";

/**
 * Calculates the start/end times and dependency graph structure for the Gantt chart.
 */
function calculateTaskTimes(nodes, links) {
    const blockingLinks = links.filter(link => link.isBlocking);

    const times = new Map(nodes.map(n => [n.id, {
        start: 0,
        end: 0,
        duration: Math.max(1, n.storyPoints || 1)
    }]));

    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const adj = new Map(nodes.map(n => [n.id, []]));

    blockingLinks.forEach(link => {
        const source = link.source.id || link.source;
        const target = link.target.id || link.target;
        adj.get(source).push(target);
        inDegree.set(target, (inDegree.get(target) || 0) + 1);
    });

    const inDegreeForSort = new Map(inDegree);

    const queue = nodes
        .filter(n => inDegreeForSort.get(n.id) === 0)
        .map(n => n.id)
        .sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));

    let head = 0;
    while (head < queue.length) {
        const u_id = queue[head++];

        const u_task = times.get(u_id);
        u_task.end = u_task.start + u_task.duration;

        const neighbors = (adj.get(u_id) || []).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));

        for (const v_id of neighbors) {
            const v_task = times.get(v_id);
            v_task.start = Math.max(v_task.start, u_task.end);
            inDegreeForSort.set(v_id, inDegreeForSort.get(v_id) - 1);
            if (inDegreeForSort.get(v_id) === 0) {
                queue.push(v_id);
            }
        }
    }
    return { times, adj, inDegree };
}

/**
 * Updates the visual highlighting of rows in the Gantt chart.
 */
export function updateGanttSelection(selectedNodeId) {
    const ganttRowsContainer = document.getElementById('gantt-rows');
    if (!ganttRowsContainer) return;

    ganttRowsContainer.querySelectorAll('[data-node-id]').forEach(row => {
        const isSelected = row.dataset.nodeId === selectedNodeId;
        
        row.classList.toggle('bg-indigo-100', isSelected); 
        row.classList.toggle('hover:bg-indigo-100', isSelected); 
        row.classList.toggle('hover:bg-gray-100', !isSelected); 
    });
}

export function renderGanttChart(
    data, 
    JIRA_URL,
    handleNodeSelect, 
    selectedNodeId
) {

    const ganttHeaderContainer = document.getElementById('gantt-header');
    const ganttRowsContainer = document.getElementById('gantt-rows');
    const filterCheckbox = document.getElementById('gantt-filter-completed');
    
    const newGanttRowsContainer = ganttRowsContainer.cloneNode(false);
    ganttRowsContainer.parentNode.replaceChild(newGanttRowsContainer, ganttRowsContainer);
    ganttHeaderContainer.innerHTML = '';

    const filterIsActive = filterCheckbox.checked;
    const nodesToRender = filterIsActive 
        ? data.nodes.filter(n => n.statusCategory !== "Done")
        : data.nodes;

    const nodesToRenderIds = new Set(nodesToRender.map(n => n.id));
    const linksToRender = data.links.filter(link => 
        nodesToRenderIds.has(link.source.id || link.source) && 
        nodesToRenderIds.has(link.target.id || link.target)
    );


    const { times: taskTimes, adj, inDegree } = calculateTaskTimes(nodesToRender, linksToRender);
    
    let maxTime = 0;
    for (const task of taskTimes.values()) {
        if (task.end > maxTime) maxTime = task.end;
    }
    const scaleEnd = maxTime;

    const sortedNodes = [];
    const visited = new Set();
    const nodeMap = new Map(nodesToRender.map(n => [n.id, n]));

    function dfs(nodeId) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        const node = nodeMap.get(nodeId);
        if (node) sortedNodes.push(node);
        const neighbors = (adj.get(nodeId) || []).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        for (const neighborId of neighbors) {
            dfs(neighborId);
        }
    }

    const rootNodes = nodesToRender
        .filter(n => inDegree.get(n.id) === 0)
        .sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric: true}));

    rootNodes.forEach(root => dfs(root.id));

    nodesToRender.forEach(node => {
        if (!visited.has(node.id)) {
            dfs(node.id);
        }
    });

    const epicKeys = [...new Set(nodesToRender.map(n => n.epic).filter(Boolean))];
    const epicColors = {};
    epicKeys.forEach((key, i) => {
        epicColors[key] = epicPalette[i % epicPalette.length];
    });

    const ganttRowsHTML = sortedNodes.map(node => {
        const times = taskTimes.get(node.id);
        if (!times || !scaleEnd) return '';
        const leftPercent = (times.start / scaleEnd) * 100;
        const widthPercent = (times.duration / scaleEnd) * 100;
        return `
            <div data-node-id="${node.id}" class="flex items-center p-2 border-b border-gray-200 text-sm cursor-pointer hover:bg-gray-100 rounded-lg">
                <div class="w-1/3 truncate flex items-center" title="${node.summary}">
                    ${node.epic ? `<a href="${JIRA_URL}/browse/${node.epic}" target="_blank" class="mr-2 px-2 py-1 rounded-full font-bold text-xs" style="background:${epicColors[node.epic]};color:#fff;">${node.epic}</a>` : ''}
                    <span class="font-mono text-xs text-gray-500">${node.id}</span>
                    <span class="ml-2">${node.summary}</span>
                </div>
                <div class="w-2/3 relative h-6 bg-gray-200 rounded">
                    <div class="absolute h-6 rounded text-white text-xs flex items-center justify-center overflow-hidden" title="${node.storyPoints || 1} points" style="background-color: ${statusColors[node.statusCategory] || statusColors.default}; left: ${leftPercent}%; width: ${widthPercent}%;">
                        <span class="px-1">${node.storyPoints || 'n/a'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    newGanttRowsContainer.innerHTML = ganttRowsHTML;


    let headerLevelsHTML = '';
    if (scaleEnd > 0) {
        let increment = 1;
        if (scaleEnd > 50) increment = 10;
        else if (scaleEnd > 20) increment = 5;
        else if (scaleEnd > 10) increment = 2;
        for (let i = increment; i <= scaleEnd; i += increment) {
            const position = (i / scaleEnd) * 100;
            headerLevelsHTML += `<div class="absolute h-full top-0" style="left: ${position}%;"><div class="w-px h-2 bg-gray-300"></div><div class="absolute -top-4 text-xs text-gray-500" style="transform: translateX(-50%);">${i}</div></div>`;
        }
    }
    ganttHeaderContainer.innerHTML = `
        <div class="flex items-center border-b-2 pb-2 mb-4 text-sm">
            <div class="w-1/3 flex items-center space-x-2 pr-2"> 
                <div class="font-bold text-left w-24 flex-shrink-0">Epic</div> 
                <div class="font-bold text-left w-24 flex-shrink-0">Issue</div> 
                <div class="font-bold text-left flex-grow">Description</div> 
            </div>
            <div class="w-2/3 relative h-1">
                <div class="absolute -top-4 left-0 text-xs text-gray-500">0</div>
                ${headerLevelsHTML}
            </div>
        </div>
    `;

    newGanttRowsContainer.addEventListener('click', (event) => {
        const row = event.target.closest('[data-node-id]');
        if (!row) return; 

        const nodeId = row.dataset.nodeId;
        const newSelectionId = (nodeId === selectedNodeId) ? null : nodeId;
        if (typeof handleNodeSelect === 'function') {
            handleNodeSelect(newSelectionId);
        }
    });

    if (selectedNodeId) {
        const selectedRow = newGanttRowsContainer.querySelector(`[data-node-id="${selectedNodeId}"]`);
        if (selectedRow) {
            selectedRow.classList.add('bg-indigo-100', 'hover:bg-indigo-100');
            selectedRow.classList.remove('hover:bg-gray-100');
            selectedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}
