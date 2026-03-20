// --- JIRA & D3 LOGIC ---

import { setActiveView } from "./state.js";
import { renderGraph } from "./graph.js";

export async function fetchDataAndRender(JIRA_URL, dataSource,
  handleNodeSelect,
  selectedNodeId,
  handleSimulation,
  simulation,
  handleZoom,
  zoom,
  graphContainer,
  ganttContainer,
  estimateContainer,
  loader,
  placeholder,
  issueDetailsPanel,
  epicHeader,
  epicTitle,
  epicSummary,
  resetViewBtn,
  showGraphBtn,
  showGanttBtn,
  showEstimateBtn
) {
    loader.classList.remove('hidden');
    placeholder.classList.add('hidden');
    issueDetailsPanel.classList.add('hidden');
    epicHeader.classList.add('hidden');
    resetViewBtn.classList.add('hidden');
    d3.select("#graph-svg").selectAll("*").remove();

    const ganttHeaderContainer = document.getElementById('gantt-header');
    const ganttRowsContainer = document.getElementById('gantt-rows');
    if(ganttHeaderContainer) ganttHeaderContainer.innerHTML = '';
    if(ganttRowsContainer) ganttRowsContainer.innerHTML = '';

    try {
        let responseData;

        if (dataSource.mode === 'sprint') {
            const response = await fetch('/api/sprint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sprintId: dataSource.sprintId })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Request failed: ${response.status}`);
            }
            responseData = await response.json();
        } else {
            const response = await fetch('/api/jira', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ epicKeys: dataSource.epicKeys })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Request failed: ${response.status}`);
            }
            responseData = await response.json();
        }

        const { epic, nodes, links } = processJiraData(
            responseData.issues,
            responseData.storyPointFieldId,
            responseData.skillFieldId,
            dataSource.mode === 'sprint' ? [] : dataSource.epicKeys
        );

        if (dataSource.mode === 'sprint') {
            epicTitle.textContent = dataSource.sprintName;
            let datesText = '';
            if (dataSource.sprintStartDate && dataSource.sprintEndDate) {
                const fmt = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                datesText = `${fmt(dataSource.sprintStartDate)} – ${fmt(dataSource.sprintEndDate)}`;
            }
            epicSummary.textContent = datesText;
            epicHeader.classList.remove('hidden');
        } else if (epic) {
            if (epic.epics) {
                epicTitle.textContent = epic.epics.length > 1 ? 'Multiple Epics' : '';
                epicSummary.innerHTML = epic.epics.map(e => `
                    <div>
                        <a href="${JIRA_URL}/browse/${e.key}" target="_blank" class="text-indigo-600 hover:underline font-mono">${e.key}</a>:
                        <span class="text-gray-600">${e.summary}</span>
                    </div>
                `).join('');
            } else {
                epicTitle.innerHTML = `<a href="${JIRA_URL}/browse/${epic.id}" target="_blank" class="text-indigo-600 hover:underline">${epic.id}</a>`;
                epicSummary.textContent = epic.summary;
            }
            epicHeader.classList.remove('hidden');
        }

        const graph = { nodes, links };

        if (graph.nodes.length > 0) {
            setActiveView('graph', graphContainer, ganttContainer, estimateContainer, showGraphBtn, showGanttBtn, showEstimateBtn);
            renderGraph(
              graph,
              selectedNodeId,
              graphContainer,
              handleNodeSelect,
              simulation,
              handleSimulation,
              zoom,
              handleZoom,
              JIRA_URL,
              issueDetailsPanel
            );
            resetViewBtn.classList.remove('hidden');
        } else {
            const label = dataSource.mode === 'sprint' ? `Sprint "${dataSource.sprintName}"` : `Epic ${dataSource.epicKeys}`;
            placeholder.innerHTML = `<p class="text-xl font-medium text-red-500">No issues found for ${label}.</p>`;
            placeholder.classList.remove('hidden');
        }
        return graph;

    } catch (error) {
        console.error('Error fetching from Jira:', error);
        placeholder.innerHTML = `<p class="text-xl font-medium text-red-500">Failed to fetch data.</p><p class="mt-2 text-sm">${error.message}</p>`;
        placeholder.classList.remove('hidden');
    } finally {
        loader.classList.add('hidden');
    }
}

/**
 * Processes Jira issue links to correctly handle all link types
 * and add an `isBlocking` flag for use in both views.
 */
function processJiraData(issues, storyPointFieldId, skillFieldId, EPIC_KEY) {
    const epicKeys = Array.isArray(EPIC_KEY) ? EPIC_KEY : [EPIC_KEY];
    const epicIssues = issues.filter(issue => epicKeys.includes(issue.key));
    const childIssues = issues.filter(issue => !epicKeys.includes(issue.key));

    const nodes = childIssues.map(issue => ({
        id: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        statusCategory: issue.fields.status.statusCategory.name,
        type: issue.fields.issuetype.name,
        assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
        storyPoints: (storyPointFieldId && issue.fields[storyPointFieldId] !== null) ? issue.fields[storyPointFieldId] : null,
        skill: issue.fields[skillFieldId]?.value?.toLowerCase() || 'unskilled',

        epic: issue.fields.parent ? issue.fields.parent.key : (issue.fields['Epic Link'] || null)
    }));

    const links = [];
    const processedLinks = new Set(); // Use a set to track processed pairs and prevent duplicates

    childIssues.forEach(issue => {
        if (issue.fields.issuelinks) {
            issue.fields.issuelinks.forEach(link => {
                let sourceId, targetId, linkType;
                let isBlocking = false;

                if (link.outwardIssue) {
                    sourceId = issue.key;
                    targetId = link.outwardIssue.key;
                    linkType = link.type.outward;
                    if (link.type.outward.toLowerCase().trim() === 'blocks') {
                        isBlocking = true;
                    }
                } 
                else if (link.inwardIssue) {
                    sourceId = link.inwardIssue.key;
                    targetId = issue.key;
                    linkType = link.type.outward;
                    if (link.type.inward.toLowerCase().trim() === 'is blocked by') {
                        isBlocking = true;
                    }
                } else {
                    return;
                }

                const canonicalKey = [sourceId, targetId].sort().join('--');
                if (processedLinks.has(canonicalKey)) {
                    return;
                }

                if (!nodes.some(n => n.id === sourceId) || !nodes.some(n => n.id === targetId)) {
                    return;
                }

                processedLinks.add(canonicalKey);
                
                links.push({
                    source: sourceId,
                    target: targetId,
                    type: linkType, 
                    isBlocking: isBlocking
                });
            });
        }
    });
    
    let epicData = null;
    if (epicIssues.length === 1) {
        epicData = { id: epicIssues[0].key, summary: epicIssues[0].fields.summary };
    } else if (epicIssues.length > 1) {
        epicData = {
            epics: epicIssues.map(e => ({ key: e.key, summary: e.fields.summary })) 
        };
    }

    return {
        epic: epicData,
        nodes,
        links
    };
}