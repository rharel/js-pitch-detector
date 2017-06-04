(function()
{
// Computes the bin count of an FFT with given size.
function fft_bin_count(fft_size) { return fft_size / 2; }

// An audio route is a collection of three audio nodes: a source, an analyser,
// and a gain controller. The analyser and gain nodes are fixed, but the source
// node can be swapped at any time.
//
// Audio routes are used to extract time/frequency data from whatever audio
// is being streamed from their source node.
function AudioRoute(context)
{
	this._context = context;

	this._source_node = null;
	this._analyser_node = this._context.createAnalyser();
	this._gain_node = this._context.createGain();

	this._analyser_node.connect(this._gain_node);
	this._gain_node.connect(this._context.destination);
}
AudioRoute.prototype =
{
	constructor: AudioRoute,

	get_byte_frequency_data: function(buffer)
	{
		this._analyser_node.getByteFrequencyData(buffer);
	},
	get_float_frequency_data: function(buffer)
	{
		this._analyser_node.getFloatFrequencyData(buffer);
	},
	get_byte_time_data: function(buffer)
	{
		this._analyser_node.getByteTimeDomainData(buffer);
	},
	get_float_time_data: function(buffer)
	{
		this._analyser_node.getFloatTimeDomainData(buffer);
	},

	get context() { return this._context; },

	get source() { return this._source_node; },
	set source(node)
	{
		if (this._source_node !== null)
		{
			this._source_node.disconnect();
		}
		this._source_node = node;
		this._source_node.connect(this._analyser_node);
	},

	get fft_size() { return this._analyser_node.fftSize; },
	set fft_size(value) { this._analyser_node.fftSize = value|0; },

	get volume() { return this._gain_node.gain.value; },
	set volume(value) { this._gain_node.gain.value = +value; },
};

// An audio system is a wrapper around an audio route that manages and limits
// access to that route to one user at a time.
function AudioSystem(context)
{
	this._route = new AudioRoute(context);
	this._on_release = null;
}
AudioSystem.prototype =
{
	constructor: AudioSystem,

	acquire: function(on_release)
	{
		if (this._on_release === on_release) { return; }

		this.release();
		this._on_release = on_release;
	},
	release: function()
	{
		if (this._on_release === null) { return; }

		this._on_release();
		this._on_release = null;
	},

	get sample_rate() { return this.context.sampleRate; },
	get band_size() { return this.sample_rate / 2; },

	resolution: function(fft_size)
	{
		return this.band_size / fft_bin_count(fft_size);
	},
	recommend_size: function(desired_resolution)
	{
		const exact_recommendation = 2 * this.band_size / desired_resolution;

		// Now find the nearest power of two that is >= the exact
		// recommendation:
		let nearest_power_of_two = 512;
		while (nearest_power_of_two < exact_recommendation)
		{
			nearest_power_of_two *= 2;
		}
		return nearest_power_of_two;
	},

	get context() { return this._route.context; },
	get route() { return this._route; }
};

// An audio clip wraps around an audio buffer and analysis/playback parameters.
// Audio clips are played on the specified audio system.
function AudioClip(audio_system, audio_buffer, volume = 0.25, fft_size = 2048)
{
	this._audio_system = audio_system;
	this._audio_buffer = audio_buffer;
	this._volume = volume;
	this._fft_size = fft_size;

	this._source = null;
	this._is_playing = false;

	this._stop_event_listeners = [];
}
AudioClip.prototype =
{
	constructor: AudioClip,

	play: function()
	{
		if (this._is_playing) { return; }

		this._audio_system.acquire(() => this.stop());

		this._source = this._audio_system.context.createBufferSource();
		this._source.buffer = this._audio_buffer;

		this._audio_system.route.source = this._source;
		this._audio_system.route.volume = this._volume;
		this._audio_system.route.fft_size = this._fft_size;

		this._source.addEventListener("ended", () =>
		{
			if (!this._is_playing) { return; }

			this._audio_system.release();
		});
		this._source.start();
		this._is_playing = true;
	},
	stop: function()
	{
		if (!this._is_playing) { return; }

		this._is_playing = false;
		this._source.stop();
		this._stop_event_listeners.forEach(callback => callback(this));
	},

	on_stop: function(listener)
	{
		this._stop_event_listeners.push(listener);
	},

	get context() { return this._audio_system.context; },
	get route() { return this._audio_system.route; },
	get system() { return this._audio_system; },

	get volume() { return this._volume; },
	set volume(value) { this._volume = +value; },

	get fft_size() { return this._fft_size; },
	set fft_size(value) { this._fft_size = value|0; },

	get fft_bin_count() { return fft_bin_count(this._fft_size); },

	get is_playing() { return this._is_playing; }
};
AudioClip.load_url = (function()
{
	const audio_requests = {};
	const audio_buffers = {};

	return function(url, context, on_success)
	{
		if (audio_buffers.hasOwnProperty(url))
		{
			on_success(audio_buffers[url]);
			return;
		}
		else if (audio_requests.hasOwnProperty(url))
		{
			audio_requests[url].push(buffer => on_success(buffer));
			return;
		}

		const request = new XMLHttpRequest();
		request.open("GET", url, true);
		request.responseType = "arraybuffer";
		request.addEventListener("load", on_response);
		request.send();

		audio_requests[url] = [];

		function on_response()
		{
			context.decodeAudioData(request.response)
			.catch(error =>
				console.log("Could not load audio into buffer: " + error))
			.then(audio_buffer =>
			{
				audio_buffers[url] = audio_buffer;
				audio_requests[url].forEach(callback => callback(audio_buffer));
				audio_requests[url] = [];
				on_success(audio_buffer)
			});
		}
	}
})();
AudioClip.from_url = function(url, audio_system, on_success)
{
	AudioClip.load_url(url, audio_system.context, audio_buffer =>
	{
		on_success(new AudioClip(audio_system, audio_buffer));
	});
};

window.Audio =
{
	fft_bin_count: fft_bin_count,

	Route: AudioRoute,
	System: AudioSystem,
	Clip: AudioClip,

	start_capture: function(audio_route)
	{
		return navigator.mediaDevices.getUserMedia({ audio: true })
		.then(media_stream =>
		{
			audio_route.source =
				audio_route.context.createMediaStreamSource(media_stream);
		});
	}
};
})();

(function()
{
// code.stephenmorley.org
function Queue(){var a=[],b=0;this.getLength=function(){return a.length-b};this.isEmpty=function(){return 0==a.length};this.enqueue=function(b){a.push(b)};this.dequeue=function(){if(0!=a.length){var c=a[b];2*++b>=a.length&&(a=a.slice(b),b=0);return c}};this.peek=function(){return 0<a.length?a[b]:void 0}};

function find_maximum_intensity_bin(bins, range)
{
	let max_bin = 0;
	let max_intensity = 0;

	for (let i = range.min; i < range.max; ++i)
	{
		if (bins[i] > max_intensity)
		{
			max_bin = i;
			max_intensity = bins[i];
		}
	}

	return max_bin;
}

function detect_naively(bins, range, resolution)
{
	const max_bin = find_maximum_intensity_bin(bins, range);
	const max_frequency = (max_bin + 0.5) * resolution;

	return MusicNoteUtilities.Note
		.from_frequency(max_frequency)
		.to_string();
}

function Detector(intensity_threshold, window_size)
{
	this._intensity_threshold = intensity_threshold;
	this._window_size = window_size;

	this._window = new Queue();
	this._count = {};

	this.reset();
}
Detector.prototype =
{
	constructor: Detector,

	push: function(incoming_note)
	{
		const outgoing_note = this._window.dequeue();
		if (outgoing_note !== null)
		{
			this._count[outgoing_note] -= 1;
		}

		this._window.enqueue(incoming_note);

		if (!(incoming_note in this._count))
		{
			this._count[incoming_note] = 0;
		}
		this._count[incoming_note] += 1;
	},

	reset: function()
	{
		while (!this._window.isEmpty()) { this._window.dequeue(); }

		for (let i = 0; i < this._window_size; ++i)
		{
			this._window.enqueue(null);
		}
		for (let note in this._count)
		{
			if (!this._count.hasOwnProperty(note)) { continue; }
			this._count[note] = 0;
		}
	},
	detect: function(bins, range, resolution)
	{
		const max_bin = find_maximum_intensity_bin(bins, range);
		const max_intensity = bins[max_bin];

		if (max_intensity < this._intensity_threshold)
		{
			return "";
		}

		const max_frequency = (max_bin + 0.5) * resolution;
		this.push
		(
			MusicNoteUtilities.Note
				.from_frequency(max_frequency)
				.to_string()
		);

		let dominant_note = "";
		let dominant_note_count = 0;

		for (const note in this._count)
		{
			if (!this._count.hasOwnProperty(note)) { continue; }

			const count = this._count[note];
			if (count > dominant_note_count)
			{
				dominant_note = note;
				dominant_note_count = count;
			}
		}
		return dominant_note;
	}
};

window.PitchDetection =
{
	detect_naively: detect_naively,
	Detector: Detector
};
})();

(function()
{
// Ties the playback of an audio clip to an animated canvas.
function AudioClipAnimation(audio_clip, canvas)
{
	this._canvas = canvas;
	this._audio_clip = audio_clip;

	this._graphics_context = this._canvas.getContext("2d");
	this._requested_animation_frame = null;

	this._animation_frame_event_listeners = [];
	this._animation_stop_event_listeners = [];

	this._audio_clip.on_stop(() =>
	{
		cancelAnimationFrame(this._requested_animation_frame);
		this._dispatch_animation_stop_event();
	});
}
AudioClipAnimation.prototype =
{
	constructor: AudioClipAnimation,

	toggle_play: function()
	{
		if (this.is_playing) { this.stop(); }
		else { this.play(); }
	},
	play: function()
	{
		if (this.is_playing) { return; }

		this._requested_animation_frame =
		(
			requestAnimationFrame(() => this._animate())
		);
		this._audio_clip.play();
	},
	stop: function()
	{
		if (!this.is_playing) { return; }

		this._audio_clip.stop();
	},

	on_animation_frame: function(listener)
	{
		this._animation_frame_event_listeners.push(listener);
	},
	on_animation_stop: function(listener)
	{
		this._animation_stop_event_listeners.push(listener);
	},

	get audio_clip() { return this._audio_clip; },
	get canvas() { return this._canvas; },

	get graphics_context() { return this._graphics_context; },

	get is_playing() { return this._audio_clip.is_playing; },

	_animate: function()
	{
		if (!this.is_playing) { return; }

		this._requested_animation_frame =
		(
			requestAnimationFrame(() => this._animate())
		);
		this._dispatch_animation_frame_event();
	},

	_dispatch_animation_frame_event: function()
	{
		this._animation_frame_event_listeners
			.forEach(callback => callback(this));
	},
	_dispatch_animation_stop_event: function()
	{
		this._animation_stop_event_listeners
			.forEach(callback => callback(this));
	}
};
AudioClipAnimation.for_time_domain = function(audio_clip, canvas, style = {})
{
	const animation = new AudioClipAnimation(audio_clip, canvas);
	const data = new Uint8Array(audio_clip.fft_bin_count);

	draw_flat_line();
	animation.on_animation_frame(() =>
	{
		audio_clip.route.get_byte_time_data(data);
		draw_time_domain();
	});

	return { animation: animation, data: data };

	function draw_flat_line()
	{
		draw_line_strip([128, 128], animation.graphics_context, style);
	}
	function draw_time_domain()
	{
		draw_line_strip(data, animation.graphics_context, style);
	}
};
AudioClipAnimation
	.for_frequency_domain = function(audio_clip, canvas, visible_range, style = {})
{
	const animation = new AudioClipAnimation(audio_clip, canvas);
	const data = new Uint8Array(audio_clip.fft_bin_count);

	draw_background(animation.graphics_context, style.background_color);
	animation.on_animation_frame(() =>
	{
		audio_clip.route.get_byte_frequency_data(data);
		draw_frequency_domain();
	});

	return { animation: animation, data: data };

	function draw_frequency_domain()
	{
		draw_bars(data, visible_range, animation.graphics_context, style);
	}
};

// Colors over the entire context with a specified color.
function draw_background(graphics_context, color = "white")
{
	graphics_context.save();

	graphics_context.fillStyle = color;
	graphics_context.fillRect
	(
		0, 0,
		graphics_context.canvas.width,
		graphics_context.canvas.height
	);

	graphics_context.restore();
}

const DEFAULT_LINE_STRIP_DRAWING_STYLE =
	{
		background_color: "white",
		line_color: "black",
		line_width: 1,
	};
// Draw a connected line strip visualization of the specified data.
function draw_line_strip
(
	data,  // Uint8Array
	graphics_context,
	style = {})
{
	const canvas_width = graphics_context.canvas.width;
	const canvas_height = graphics_context.canvas.height;

	style = Object.assign(DEFAULT_LINE_STRIP_DRAWING_STYLE, style);

	draw_background(graphics_context, style.background_color);

	graphics_context.save();
	graphics_context.strokeStyle = style.line_color;
	graphics_context.lineWidth = style.line_width;

	const spacing = canvas_width / (data.length - 1);
	graphics_context.beginPath();
	graphics_context.moveTo(0, canvas_height * data[0] / 255);
	for(let i = 1; i < data.length; ++i)
	{
		const x = i * spacing;
		const y = canvas_height * data[i] / 255;

		graphics_context.lineTo(x, y);
	}
	graphics_context.stroke();
	graphics_context.restore();
}

const DEFAULT_BAR_DRAWING_STYLE =
{
	background_color: "white",
	bar_color: "black",
	bar_height_scale: 1.0
};
// Draw a bar graph visualization of the specified data.
function draw_bars
(
	data,  // Uint8Array
	range,  // {min: Integer, max: Integer}
	graphics_context,
	style = {})
{
	const range_size = range.max - range.min;

	const canvas_width = graphics_context.canvas.width;
	const canvas_height = graphics_context.canvas.height;

	style = Object.assign(DEFAULT_BAR_DRAWING_STYLE, style);

	draw_background(graphics_context, style.background_color);

	graphics_context.save();
	graphics_context.fillStyle = style.bar_color;

	const bar_width = (canvas_width / range_size);
	const bar_scale = style.bar_height_scale * canvas_height;

	for(let i = 0; i < range_size; ++i)
	{
		const bar_height = data[range.min + i] / 255 * bar_scale;
		if (bar_height < 1) { continue; }  // bar is too tiny to draw

		const x = i * bar_width;
		const y = canvas_height - bar_height;

		graphics_context.fillRect(x, y, bar_width, bar_height);
	}
	graphics_context.restore();
}

window.Visualization =
{
	AudioClipAnimation: AudioClipAnimation,

	draw_background: draw_background,
	draw_line_strip: draw_line_strip,
	draw_bars: draw_bars,
};
})();
