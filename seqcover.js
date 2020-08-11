var nan = NaN; // hack to support json dumped with NaN values.
const gene_plot_height = 500
const plot_colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"]

var initalIndex = 0
var currentRegion = "";
var nonCdsChecked = false;
var utrsChecked = false;
var showTranscripts = true;

/*
------------------------------------------------------------------------------------------------------------------
                                                    Plot Functions
------------------------------------------------------------------------------------------------------------------
*/

//by base depth plot layout
function get_gene_plot_layout(gene) {

    var mid = Math.round(gene.plot_coords.x.length / 2)

    var layout = {
        grid: {
            rows: 3,
            columns: 1,
        },
        autosize: true,
        height: gene_plot_height,
        margin: { t: 10, r: 0, b: 30 },
        xaxis: {
            tickmode: "array",
            tickvals: [gene.plot_coords.x[0], gene.plot_coords.x[mid], gene.plot_coords.x[gene.plot_coords.x.length - 10]],
            ticktext: [gene.plot_coords.g[0], gene.plot_coords.g[mid], gene.plot_coords.g[gene.plot_coords.x.length - 10]],
            // title: "Chromosome " + String(gene.unioned_transcript.chr).replace("chr", "")
        },
        yaxis: {
            title: "Depth",
            domain: [0.55, 1]
        },
        yaxis2: {
            //title: "Merged<br>Transcripts",

            range: [0.5, -0.5],
            showlegend: false,
            zeroline: false,
            tickvals: [0],
            ticktext: ["Merged<br>Transcript"],
            tickangle: 40,
            domain: [0.0, 0.3],
        },
        hovermode: 'closest',
        hoverdistance: 100000,
        showlegend: false,
    };

    //Add the 3rd layout if show transcripts is on
    if (showTranscripts) {
        layout.yaxis.domain = [0.55, 0.90]
        layout.yaxis2.domain = [0.4, 0.55]
        layout.yaxis3 = {
            range: [0, 2],
            zeroline: false,
            showlegend: false,
            domain: [0.0, 0.40],
            tickangle: 40,
            ticktext: gene.transcripts.map(t => t.name),
        }


    };

    return (layout)

};


//Get a by position trace per sample of depth
function get_depth_trace(gene) {

    var traces = [];

    for (sample in gene.plot_coords.depths) {
        var dp = gene.plot_coords.depths[sample]
        dp = dp.map(function (v) { return v < -1000 ? NaN : v })

        var trace = {
            x: gene.plot_coords.x, text: gene.plot_coords.g, y: dp,
            type: 'scatter', mode: 'lines', name: sample, line: { width: 1 },
            hovertemplate: '<b>position</b>:%{text}<br><b>depth</b>:%{y}<br>(debug) x: %{x}',
            hoverinfo: "text",
            yaxis: "y",
        };

        traces.push(trace);
    };

    return (traces)

};


function binary_search(A, v) {
    var result = 0;
    var j = A.length
    while (j != 0) {
        let step = j >> 1
        let pos = result + step;
        if (A[pos] < v) {
            result = pos + 1
            j -= step + 1
        } else {
            j = step
        }

    }
    return result
}


//Get the transcript shapes for the current region
function get_transcript_traces(gene, transcripts, plotRef) {
    var traces = []
    // use negative values for y_offset so we can tell from y-value if we
    // are in depth plot (which must be positive) or in transcript plot

    transcripts.forEach((transcript, y_offset) => {
        var trs = transcript.traces(-(y_offset), gene.plot_coords.x, gene.plot_coords.g)
        trs.forEach(t => {
            t.yaxis = plotRef
            traces.push(t)
        })
    })
    return traces
};


function plot_per_base_depth(gene) {

    gene_layout = get_gene_plot_layout(gene)

    var depth_traces = get_depth_trace(gene)

    var unioned_transcript_traces = get_transcript_traces(gene, [gene.unioned_transcript], "y2")
    unioned_transcript_traces.forEach(t => depth_traces.push(t))

    if (showTranscripts) {
        var transcript_traces = get_transcript_traces(gene, gene.transcripts, "y3")
        transcript_traces.forEach(t => depth_traces.push(t))
        // each transcript is centered on the negative integers.
        gene_layout.yaxis3.range = [0.5, -(1 + transcript_traces.length / 3)]
        gene_layout.yaxis3.tickvals = [...Array(gene.transcripts.length).keys()].map(f => -f)
        gene_layout.yaxis3.ticktext = gene.transcripts.map(t => t.name)
        console.log(gene_layout.yaxis3)

    };

    Plotly.newPlot("gene_plot", depth_traces, gene_layout)

    var d = document.getElementById("gene_plot")
    var hoverInfo = document.getElementById("hoverInfo")
    d.on("plotly_hover", data => {
        handle_hover(data, depth_traces, gene, gene_layout)
        Plotly.react("gene_plot", depth_traces, gene_layout)
        data.event.stopPropagation()
    }).on("plotly_unhover", data => {
        hoverInfo.innerHTML = ""
        if (gene_layout.shapes != undefined && gene_layout.shapes.length > 0) {
            gene_layout.shapes.pop()
        }
        Plotly.react("gene_plot", depth_traces, gene_layout)
        data.event.stopPropagation()
    });

};

function mean(data) {
    var result = 0
    var n = 0
    for (var i = 0; i < data.length; i++) {
        let d = data[i]
        if (d >= 0) {
            n += 1
            result += d
        }
    }
    return result / n
}

function handle_hover(data, depth_traces, gene, gene_layout) {
    //  this function handles hover events in the transcript plots. it
    //  finds the correct transcript and feature (exon/transcript/UTR, etc)
    //  and calculates stats, and updates the gene_layout to draw the
    //  region shape.
    //
    let ax = data.yaxes[0]._attr;
    // don't handle hover in depth plot
    if (ax == "yaxis") { return false; }
    // this is the x in plot coordinates.
    var x = Math.round(data.xvals[0])
    var y = Math.round(Math.abs(data.yvals[0])) // can now use this as an index to get the transcript.
    var transcript = ax == "yaxis2" ? gene.unioned_transcript : gene.transcripts[y]
    if (transcript == undefined) { return false }

    let overlaps = transcript.overlaps(x)
    if (overlaps.length > 1) {
        if (overlaps.some(p => p.type == FeatureType.CDS)) {
            overlaps = overlaps.filter(p => p.type == FeatureType.CDS)
        } else if (overlaps.some(p => p.type == FeatureType.EXON)) {
            overlaps = overlaps.filter(p => p.type == FeatureType.EXON)
        }
    }
    if (overlaps.length == 0) {
        overlaps.push(new Feature(transcript.txstart, transcript.txend, FeatureType.TRANSCRIPT))
    }
    if (gene_layout.shapes == undefined) { gene_layout.shapes = [] }
    gene_layout.shapes.push({
        type: "rect",
        xref: "x",
        yref: "paper",
        y0: 0,
        y1: 1,
        fillcolor: "#cccccc",
        opacity: 0.2,
        x0: overlaps[0].start,
        x1: overlaps[0].stop,
    })

    var start_idx = binary_search(gene.plot_coords.x, overlaps[0].start)
    var stop_idx = binary_search(gene.plot_coords.x, overlaps[0].stop)

    var gstart = gene.plot_coords.g[start_idx]
    var gstop = gene.plot_coords.g[stop_idx]

    var means = {}
    hoverInfo.innerHTML = `${gene.unioned_transcript.chr}:${gstart}-${gstop}<br><ul>`
    for (var sample in gene.plot_coords.depths) {
        let depths = gene.plot_coords.depths[sample];
        means[sample] = mean(depths.slice(start_idx, stop_idx)).toPrecision(4)
        hoverInfo.innerHTML += `<li><b>${sample}</b> mean depth for ${overlaps[0].type.toString()}: ${means[sample]}<br></li>`
    }
    hoverInfo.innerHTML += "</ul>"


}

/*
------------------------------------------------------------------------------------------------------------------
                                                    Event Handling
------------------------------------------------------------------------------------------------------------------
*/

// Controller function for generating gene/region specific plots
function generate_plots(selected_region) {

    var g = plot_data[selected_region]
    if (g.unioned_transcript.constructor.name == "Object") {
        g.unioned_transcript = new Transcript(g.unioned_transcript)
    }
    g.transcripts = g.transcripts.map(t => new Transcript(t))

    //Plot per base depths
    plot_per_base_depth(g)

};

function selected_region_index() {
    return parseInt($('#region-select').find(':selected')[0].value)
}

$("#btn-copy-region").click(function () {
    var $temp = $("<input>")
    $("body").append($temp)

    let pd = plot_data[selected_region_index()]
    let region = `${pd.unioned_transcript.chr}:${pd.plot_coords.g[0]}-${pd.plot_coords.g[pd.plot_coords.g.length - 1]}`

    $temp.val(region).select()
    document.execCommand("copy")
    $temp.remove()

    $("#btn-copy-region").attr("title", "Copied!").tooltip("_fixTitle").tooltip("show").attr("title", "Copy selected region").tooltip("_fixTitle")
})

function next_region(offset = 1) {
    // get the selected index
    let selected_index = selected_region_index()
    let next_index;
    // previous
    if (offset == -1) {
        if (selected_index == 0) {
            next_index = plot_data.length - 1
        } else {
            next_index = selected_index - 1
        }
    } else {
        if (selected_index == plot_data.length - 1) {
            next_index = 0
        } else {
            next_index = selected_index + 1
        }
    }
    $('#region-select').val(next_index)
    $('#region-select').trigger('change')
}

function register_handlers() {
    let regions = []

    for (const [i, pd] of plot_data.entries()) {
        let region = `
            <div>
                <div class="select-title pr-3">
                    ${pd.symbol}
                </div>
                <div class="select-location">
                    ${pd.unioned_transcript.chr}:${pd.plot_coords.g[0]}-${pd.plot_coords.g[pd.plot_coords.g.length - 1]}</span>
                </div>
            </div>
        `
        // also pushes duplicates
        regions.push({ "id": i, "text": region, title: `${pd.symbol}` })
    }
    // n = gene symbol, v = the index
    $("#region-select").select2({
        data: regions,
        escapeMarkup: function (markup) {
            return markup
        },
        selectOnClose: true,
        width: 'resolve',
        theme: 'bootstrap4',
    })
    if (plot_data.length > 1) {
        $('#region-select').on('change', function () {
            generate_plots(this.value)
        })

        $("#btn-previous").click(function () {
            next_region(-1)
        })

        $("#btn-next").click(function () {
            next_region()
        })

        document.addEventListener("keydown", function (e) {
            if (e.which == 37) {
                next_region(-1)
            } else if (e.which == 39) {
                next_region()
            } else {
                return
            }
        })
    } else {
        document.getElementById("region-select").disabled = true
        document.getElementById("btn-previous").disabled = true
        document.getElementById("btn-next").disabled = true
    }

    //Turn on or off UTR regions in the transcript plot
    $("#utrs").on('change', function (e) {

        utrsChecked = this.checked

        //Redraw per base depth plot
        //Index of plot in plot_data and gene data
        var plotIndex = selected_region_index()
        var selectedGene = plot_data[plotIndex];

        //Plot per base depths
        plot_per_base_depth(selectedGene)

    });


    //Turn on or off Non-CDS Exons in the transcript plot
    $("#nonCdsExons").on('change', function (e) {

        nonCdsChecked = this.checked

        //Redraw per base depth plot
        //Index of plot in plot_data and gene data
        var plotIndex = selected_region_index()
        var selectedGene = plot_data[plotIndex];

        //Plot per base depths
        plot_per_base_depth(selectedGene)

    });

    //Turn on and off the transcript plot
    // $("#showTranscripts").click(function () {

    //     //Update bool value for transcripts
    //     showTranscripts = !(showTranscripts)

    //     // Update button text
    //     // Update div class
    //     if (showTranscripts) {
    //         $(this).text("Hide Transcripts")
    //         document.getElementById("gene_plot").className = "big_div";
    //     } else {
    //         $(this).text("Show Transcripts")
    //         document.getElementById("gene_plot").className = "med_div";
    //     };

    //     //Redraw per base depth plot
    //     //Index of plot in plot_data and gene data
    //     var plotIndex = selected_region_index()
    //     var selectedGene = plot_data[plotIndex];

    //     //Plot per base depths
    //     plot_per_base_depth(selectedGene)

    // });
}

//Load first region
jQuery(document).ready(function () {
    // register tooltips
    $('[data-toggle="tooltip"]').tooltip()
    generate_plots(0)
    register_handlers()
})
