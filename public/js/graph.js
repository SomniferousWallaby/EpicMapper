/**
 * Renders the D3 graph view
 */

import { statusColors } from "./colors.js";

function drag(simulation) {
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.01).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
    return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
}

export function renderGraph(
  graph,
  selectedNodeId, 
  graphContainer, 
  onNodeSelect,
  simulation, 
  handleSimulation, 
  zoom, 
  handleZoom

) {
    let node; 
    const width = graphContainer.clientWidth;
    const height = graphContainer.clientHeight;
    const svg = d3.select("#graph-svg").attr("viewBox", [0, 0, width, height]);
    svg.selectAll("*").remove();
    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "none")
        .style("pointer-events", "all")
        .on("click", () => {
            onNodeSelect(null); 
        });

    const container = svg.append("g");
    const maxStoryPoints = d3.max(graph.nodes, d => d.storyPoints) || 1;
    const radiusScale = d3.scaleSqrt().domain([0, maxStoryPoints]).range([8, 25]);

    container.append("defs").append("marker")
        .attr("id", "arrow-blocking")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 15)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#EF4444");

    simulation = d3.forceSimulation(graph.nodes)
        .force("link", d3.forceLink(graph.links).id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-20))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(d => radiusScale(d.storyPoints) + 5));
    if (typeof handleSimulation === 'function') {
        handleSimulation(simulation);
    }

    const link = container.append("g").attr("class", "links").selectAll("line")
        .data(graph.links)
        .join("line")
        .style("stroke", d => d.isBlocking ? "#EF4444" : "#9ca3af")
        .style("stroke-opacity", 0.8)
        .attr("marker-end", d => d.isBlocking ? "url(#arrow-blocking)" : null);

    const linkLabelGroup = container.append("g").attr("class", "link-labels").selectAll("g")
        .data(graph.links)
        .join("g");

    const linkLabelText = linkLabelGroup.append("text")
        .text(d => d.type)
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle")
        .style("font-size", "8px")
        .style("fill", "#374151");

    linkLabelGroup.insert("rect", "text")
        .attr("fill", "#f9fafb")
        .attr("rx", 3)
        .each(function(d) {
            const bbox = this.parentNode.querySelector('text').getBBox();
            d3.select(this)
                .attr("x", bbox.x - 4).attr("y", bbox.y - 2)
                .attr("width", bbox.width + 8).attr("height", bbox.height + 4);
        });

    const blockedNodeIds = new Set(
        graph.links
            .filter(link => link.isBlocking)
            .map(link => link.target.id || link.target)
    );

    node = container.append("g").attr("class", "nodes").selectAll("g")
        .data(graph.nodes).join("g").call(drag(simulation));

    node.append("circle")
        .attr("r", d => radiusScale(d.storyPoints || 0))
        .attr("fill", d => statusColors[d.statusCategory] || statusColors.default)
        .attr("stroke", d => d.id === selectedNodeId ? "#3B82F6" : (!blockedNodeIds.has(d.id) ? '#22C55E' : '#E5E7EB'))
        .attr("stroke-width", d => (d.id === selectedNodeId || !blockedNodeIds.has(d.id)) ? 3 : 1.5)
        .on("click", (event, d) => {
            event.stopPropagation();
            if (typeof onNodeSelect === 'function') {
                onNodeSelect(d.id);
            }
        });

    node.append("text")
        .text(d => d.id)
        .classed("node-label-selected", d => d.id === selectedNodeId)
        .attr("y", d => radiusScale(d.storyPoints || 0) + 12)
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .style("pointer-events", "none");

    simulation.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => {
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const targetRadius = radiusScale(d.target.storyPoints || 0);
                return d.target.x - (dx / distance) * (targetRadius + 5);
            })
            .attr("y2", d => {
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const targetRadius = radiusScale(d.target.storyPoints || 0);
                return d.target.y - (dy / distance) * (targetRadius + 5);
            });

        node.attr("transform", d => `translate(${d.x},${d.y})`);
        linkLabelGroup.attr("transform", d => {
            const x = d.source.x + 0.50 * (d.target.x - d.source.x);
            const y = d.source.y + 0.50 * (d.target.y - d.source.y);
            return `translate(${x},${y})`;
        });
    });

    zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (event) => {
        container.attr('transform', event.transform);
    });
    if (typeof handleZoom === 'function') {
        handleZoom(zoom);
    };
    svg.call(zoom);
}

/**
 * Updates the styles of the graph (selection, etc.) without re-rendering
 * the entire simulation. This is used when switching back to the graph view
 */
export function updateGraphSelection(currentGraphData, selectedNodeId) {
    if (!currentGraphData) return;

    const svg = d3.select("#graph-svg");
    const node = svg.selectAll(".nodes g");
    
    if (node.empty()) return; 

    const blockedNodeIds = new Set(
        currentGraphData.links
            .filter(link => link.isBlocking)
            .map(link => link.target.id || link.target)
    );

    node.selectAll("circle")
        .attr("stroke", n => n.id === selectedNodeId ? "#3B82F6" : (!blockedNodeIds.has(n.id) ? '#22C55E' : '#E5E7EB'))
        .attr("stroke-width", n => (n.id === selectedNodeId || !blockedNodeIds.has(n.id)) ? 3 : 1.5);

    node.selectAll("text")
        .classed("node-label-selected", n => n.id === selectedNodeId);
}