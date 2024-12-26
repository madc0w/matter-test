function load() {
	// This script relies on Matter.js (e.g., loaded via a <script> tag or import).
	// All shapes have been doubled in size compared to the previous version.

	////////////////////////////////////////////////////////
	// GLOBALS & ENGINE SETUP
	////////////////////////////////////////////////////////

	const Engine = Matter.Engine;
	const Render = Matter.Render;
	const Runner = Matter.Runner;
	const Bodies = Matter.Bodies;
	const Body = Matter.Body;
	const World = Matter.World;
	const Events = Matter.Events;
	const Composite = Matter.Composite;

	// Calculate the canvas size as 80% of the viewport
	const canvasWidth = Math.floor(window.innerWidth * 0.92);
	const canvasHeight = Math.floor(window.innerHeight * 0.92);

	// Create engine and world
	const engine = Engine.create();
	const world = engine.world;
	world.gravity.y = 0.4; // Gravity

	// Create renderer
	const render = Render.create({
		// You must provide an existing <canvas> with id="gameCanvas" in your HTML
		canvas: document.getElementById('gameCanvas'),
		engine: engine,
		options: {
			width: canvasWidth,
			height: canvasHeight,
			wireframes: false,
			background: '#f5f5f5',
		},
	});
	Render.run(render);

	// Create runner
	const runner = Runner.create();
	Runner.run(runner, engine);

	const maxVelocity = { x: 20, y: -1 };
	Matter.Events.on(engine, 'afterUpdate', function () {
		// console.log('afterUpdate');
		const allBodies = Matter.Composite.allBodies(engine.world);

		allBodies.forEach(function (body) {
			// Skip static or sensor bodies
			if (body.isStatic || body.isSensor) return;

			// Current velocities
			let vx = body.velocity.x;
			let vy = body.velocity.y;

			// Clamp horizontal velocity
			if (vx > maxVelocity.x) {
				vx = maxVelocity.x;
			} else if (vx < -maxVelocity.x) {
				vx = -maxVelocity.x;
			}

			// vy = Math.max(maxVelocity.y, vy);

			// Apply the clamped velocity
			Matter.Body.setVelocity(body, { x: vx, y: vy });
		});
	});

	////////////////////////////////////////////////////////
	// STATIC BODIES (FLOOR, WALLS)
	////////////////////////////////////////////////////////

	const floor = Bodies.rectangle(
		canvasWidth / 2,
		canvasHeight + 50,
		canvasWidth,
		100,
		{
			isStatic: true,
			render: { fillStyle: '#333' },
		}
	);
	World.add(world, floor);

	// Left and right walls, so shapes never slip off the edges
	const wallThickness = 50;
	const leftWall = Bodies.rectangle(
		-wallThickness / 2,
		canvasHeight / 2,
		wallThickness,
		canvasHeight,
		{ isStatic: true }
	);
	const rightWall = Bodies.rectangle(
		canvasWidth + wallThickness / 2,
		canvasHeight / 2,
		wallThickness,
		canvasHeight,
		{ isStatic: true }
	);
	World.add(world, [leftWall, rightWall]);

	////////////////////////////////////////////////////////
	// SHAPE DEFINITIONS
	////////////////////////////////////////////////////////

	const SHAPE_TYPES = ['circle', 'roundedRect', 'roundedTriangle'];

	const SIZE_LEVELS = [
		{ label: 'XS', circleRadius: 40, rectSize: 80, chamferRadius: 16 },
		{ label: 'S', circleRadius: 60, rectSize: 120, chamferRadius: 32 },
		{ label: 'M', circleRadius: 80, rectSize: 160, chamferRadius: 48 },
		{ label: 'L', circleRadius: 100, rectSize: 200, chamferRadius: 64 },
	];
	const sizeFactor = canvasWidth / 2000;
	for (const sl of SIZE_LEVELS) {
		sl.circleRadius *= sizeFactor;
		sl.rectSize *= sizeFactor;
		sl.chamferRadius *= sizeFactor;
	}

	// Each shape + size gets its own color
	const shapeColorMap = {
		circle: [
			'#FFB8B8', // XS
			'#FF9191', // S
			'#FF6B6B', // M
			'#FF4040', // L
		],
		roundedRect: [
			'#B8FFB8', // XS
			'#91FF91', // S
			'#6BFF6B', // M
			'#40FF40', // L
		],
		roundedTriangle: [
			'#B8B8FF', // XS
			'#9191FF', // S
			'#6B6BFF', // M
			'#4040FF', // L
		],
	};

	// Keep track of the current falling shape
	let currentShape = null;

	////////////////////////////////////////////////////////
	// COLLISION & FUSION
	////////////////////////////////////////////////////////

	Events.on(engine, 'collisionStart', (event) => {
		for (let pair of event.pairs) {
			const bodyA = pair.bodyA;
			const bodyB = pair.bodyB;

			if (bodyA.plugin?.shapeData && bodyB.plugin?.shapeData) {
				const dataA = bodyA.plugin.shapeData;
				const dataB = bodyB.plugin.shapeData;

				// If same shape and size, fuse
				if (dataA.type === dataB.type && dataA.sizeIndex === dataB.sizeIndex) {
					// Fuse if not max size
					if (dataA.sizeIndex < SIZE_LEVELS.length - 1) {
						playFuseSound();
						Composite.remove(world, bodyA);
						Composite.remove(world, bodyB);
						createShapeAtPosition(
							dataA.type,
							dataA.sizeIndex + 1,
							bodyA.position.x,
							bodyA.position.y
						);
					} else {
						// Largest size => remove after playing sound
						playMaxSizeSound();
						Composite.remove(world, bodyA);
						Composite.remove(world, bodyB);
					}
				}
			}
		}
	});

	////////////////////////////////////////////////////////
	// SHAPE CREATION
	////////////////////////////////////////////////////////

	/**
	 * Create a shape at (x, y).
	 * Uses chamfer for rectangles/triangles to produce rounded corners.
	 */
	function createShapeAtPosition(type, sizeIndex, x, y) {
		const sizeData = SIZE_LEVELS[sizeIndex];
		const shapeColor = shapeColorMap[type][sizeIndex];

		const opts = {
			friction: 0.4,
			restitution: 0.2,
			render: { fillStyle: shapeColor },
			plugin: {
				shapeData: { type, sizeIndex },
			},
		};

		let body;

		if (type === 'circle') {
			body = Bodies.circle(x, y, sizeData.circleRadius, opts);
		} else if (type === 'roundedRect') {
			// Use a rectangle with chamfer for rounding
			body = Bodies.rectangle(x, y, sizeData.rectSize, sizeData.rectSize, {
				...opts,
				chamfer: { radius: sizeData.chamferRadius },
			});
		} else if (type === 'roundedTriangle') {
			// Create a triangle using polygon(3, radius, opts)
			// For an equilateral triangle of side S, the approximate radius is ~ S / (2*sin(60°)) = S / 1.732
			const approximateRadius = sizeData.rectSize / 0.6;
			body = Bodies.polygon(x, y, 3, approximateRadius, {
				...opts,
				chamfer: { radius: sizeData.chamferRadius },
			});
		}
		Body.applyForce(
			body,
			{ x: body.position.x, y: body.position.y },
			{ x: 0, y: 0.1 }
		);

		World.add(world, body);
		currentShape = body;
	}

	/**
	 * Spawn a new shape at the top with random type (smallest size).
	 */
	function spawnShape() {
		const type = SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)];
		createShapeAtPosition(
			type,
			0,
			Math.random() * (canvasWidth - 60) + 30,
			-60
		);
	}

	/**
	 * Play sound for largest shape
	 */
	function playMaxSizeSound() {
		playSound('boom.mp3');
	}

	function playFuseSound() {
		playSound('click.mp3');
	}

	function playSound(filename) {
		filename = `/sounds/${filename}`;
		const url = new URL(location.href);
		if (url.protocol == 'file:') {
			url.pathname =
				url.pathname.substring(0, url.pathname.lastIndexOf('/')) + filename;
		} else {
			url.pathname = filename;
		}
		const audio = new Audio(url.toString());
		audio.play();
	}

	////////////////////////////////////////////////////////
	// KEYBOARD CONTROLS
	////////////////////////////////////////////////////////

	window.addEventListener('keydown', (e) => {
		if (!currentShape) return;

		// Increase force for more responsive movement
		const forceMagnitude = 0.2;
		switch (e.key) {
			case 'ArrowLeft':
				Body.applyForce(
					currentShape,
					{ x: currentShape.position.x, y: currentShape.position.y },
					{ x: -forceMagnitude, y: 0 }
				);
				break;
			case 'ArrowRight':
				Body.applyForce(
					currentShape,
					{ x: currentShape.position.x, y: currentShape.position.y },
					{ x: forceMagnitude, y: 0 }
				);
				break;
			default:
				break;
		}
	});

	////////////////////////////////////////////////////////
	// GAME LOOP
	////////////////////////////////////////////////////////

	// Start with one shape
	spawnShape();

	// If current shape is off-screen or at rest on the floor, spawn another
	(function update() {
		console.log('update');
		requestAnimationFrame(update);

		if (currentShape) {
			// Off-screen check
			if (currentShape.position.y > canvasHeight + 50) {
				Composite.remove(world, currentShape);
				currentShape = null;
				spawnShape();
			} else {
				// Check if the shape is nearly at rest near the floor
				const speed = Math.sqrt(
					currentShape.velocity.x ** 2 + currentShape.velocity.y ** 2
				);
				if (
					speed < 0.2 &&
					currentShape.prevPositionY &&
					Math.round(currentShape.position.y) ==
						Math.round(currentShape.prevPositionY)
				) {
					currentShape = null;
					spawnShape();
				}
			}
			currentShape.prevPositionY = currentShape.position.y;
		}
	})();
}
