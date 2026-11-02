import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import './App.css'


// ======================================================
// Shared helpers
// ======================================================

function getMotionCenter(data) {
  const tips = data.samples.map(
    (sample) =>
      new THREE.Vector3(
        sample.tip[0],
        sample.tip[1],
        sample.tip[2]
      )
  )

  const box = new THREE.Box3().setFromPoints(tips)

  const center = new THREE.Vector3()
  box.getCenter(center)

  return center
}


// ------------------------------------------------------
// Convert exported [w, x, y, z] quaternion
// into Three.js [x, y, z, w]
//
// Reproduce the fixed TD pre-rotation:
// X = 90°
// Y = 180°
// Z = 0°
// ------------------------------------------------------

function getBladeWidthDirection(sample) {
  const sensorQuaternion =
    new THREE.Quaternion(
      sample.q[1],
      sample.q[2],
      sample.q[3],
      sample.q[0]
    )

  const fixedRotation =
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        Math.PI / 2,
        Math.PI,
        0,
        'XYZ'
      )
    )

  const worldQuaternion =
    new THREE.Quaternion()
      .multiplyQuaternions(
        fixedRotation,
        sensorQuaternion
      )

  // Sword model local X = blade width direction

  const widthDirection =
    new THREE.Vector3(1, 0, 0)
      .applyQuaternion(worldQuaternion)

  // Keep width direction perpendicular
  // to the actual root → tip sword axis

  const root =
    new THREE.Vector3(...sample.root)

  const tip =
    new THREE.Vector3(...sample.tip)

  const swordAxis =
    tip.clone()
      .sub(root)
      .normalize()

  widthDirection.sub(
    swordAxis
      .clone()
      .multiplyScalar(
        widthDirection.dot(swordAxis)
      )
  )

  if (widthDirection.lengthSq() > 0.000001) {
    widthDirection.normalize()
  }

  return widthDirection
}


// ======================================================
// PATH
// ======================================================

function Trajectory({
  data,
  colorMode,
  playTrigger
}) {
  const startTimeRef = useRef(null)
  const lastTriggerRef = useRef(playTrigger)

  const geometry = useMemo(() => {
    if (!data) return null

    const center = getMotionCenter(data)

    const positions = []
    const colors = []

    for (const sample of data.samples) {
      positions.push(
        sample.tip[0] - center.x,
        sample.tip[1] - center.y,
        sample.tip[2] - center.z
      )

      const selectedColor =
        colorMode === 'speed'
          ? sample.speedColor
          : sample.edgeColor

      colors.push(
        selectedColor[0],
        selectedColor[1],
        selectedColor[2]
      )
    }

    const geo =
      new THREE.BufferGeometry()

    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        positions,
        3
      )
    )

    geo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        colors,
        3
      )
    )

    geo.setDrawRange(
      0,
      data.samples.length
    )

    return geo
  }, [data, colorMode])

  useFrame(({ clock }) => {
    if (!geometry || !data) return

    // New Play click

    if (
      playTrigger !==
      lastTriggerRef.current
    ) {
      lastTriggerRef.current =
        playTrigger

      startTimeRef.current =
        clock.elapsedTime

      geometry.setDrawRange(0, 1)
    }

    if (
      startTimeRef.current === null
    ) {
      return
    }

    const elapsed =
      clock.elapsedTime -
      startTimeRef.current

    let visibleSamples = 1

    for (
      let i = 0;
      i < data.samples.length;
      i++
    ) {
      if (
        data.samples[i].t <= elapsed
      ) {
        visibleSamples = i + 1
      } else {
        break
      }
    }

    geometry.setDrawRange(
      0,
      visibleSamples
    )

    if (
      elapsed >= data.duration
    ) {
      geometry.setDrawRange(
        0,
        data.samples.length
      )

      startTimeRef.current = null
    }
  })

  if (!geometry) return null

  return (
    <line geometry={geometry}>
      <lineBasicMaterial vertexColors />
    </line>
  )
}


// ======================================================
// SWEPT BLADE PLANE
// ======================================================

function BladePlane({
  data,
  colorMode,
  playTrigger
}) {
  const startTimeRef = useRef(null)
  const lastTriggerRef = useRef(playTrigger)

  const planeData = useMemo(() => {
    if (!data) return null

    const center =
      getMotionCenter(data)

    const bladeWidth =
      data.sword?.bladeWidth ?? 0.05

    const halfWidth =
      bladeWidth / 2

    // Build one blade-face pose per sample

    const poses =
      data.samples.map((sample) => {
        const root =
          new THREE.Vector3(
            sample.root[0] - center.x,
            sample.root[1] - center.y,
            sample.root[2] - center.z
          )

        const tip =
          new THREE.Vector3(
            sample.tip[0] - center.x,
            sample.tip[1] - center.y,
            sample.tip[2] - center.z
          )

        const widthDirection =
          getBladeWidthDirection(sample)

        const offset =
          widthDirection
            .clone()
            .multiplyScalar(halfWidth)

        return {
          rootLeft:
            root.clone().add(offset),

          tipLeft:
            tip.clone().add(offset)
        }
      })

    const positions = []
    const colors = []

    function addTriangle(
      a,
      b,
      c,
      color
    ) {
      positions.push(
        a.x, a.y, a.z,
        b.x, b.y, b.z,
        c.x, c.y, c.z
      )

      for (let i = 0; i < 3; i++) {
        colors.push(
          color[0],
          color[1],
          color[2]
        )
      }
    }

    function addQuad(
      a,
      b,
      c,
      d,
      color
    ) {
      addTriangle(
        a,
        b,
        c,
        color
      )

      addTriangle(
        a,
        c,
        d,
        color
      )
    }

    // Connect each blade pose to the next pose.
    // One quad = 2 triangles = 6 vertices.

    for (
      let i = 0;
      i < poses.length - 1;
      i++
    ) {
      const current =
        poses[i]

      const next =
        poses[i + 1]

      const sample =
        data.samples[i]

      const selectedColor =
        colorMode === 'speed'
          ? sample.speedColor
          : sample.edgeColor

      addQuad(
        current.rootLeft,
        current.tipLeft,
        next.tipLeft,
        next.rootLeft,
        selectedColor
      )
    }

    const geo =
      new THREE.BufferGeometry()

    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        positions,
        3
      )
    )

    geo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        colors,
        3
      )
    )

    geo.computeVertexNormals()

    const verticesPerInterval = 6

    geo.setDrawRange(
      0,
      positions.length / 3
    )

    return {
      geometry: geo,
      verticesPerInterval
    }
  }, [data, colorMode])

  useFrame(({ clock }) => {
    if (!planeData || !data) return

    if (
      playTrigger !==
      lastTriggerRef.current
    ) {
      lastTriggerRef.current =
        playTrigger

      startTimeRef.current =
        clock.elapsedTime

      planeData.geometry.setDrawRange(
        0,
        0
      )
    }

    if (
      startTimeRef.current === null
    ) {
      return
    }

    const elapsed =
      clock.elapsedTime -
      startTimeRef.current

    let visibleIntervals = 0

    for (
      let i = 1;
      i < data.samples.length;
      i++
    ) {
      if (
        data.samples[i].t <= elapsed
      ) {
        visibleIntervals = i
      } else {
        break
      }
    }

    planeData.geometry.setDrawRange(
      0,
      visibleIntervals *
        planeData.verticesPerInterval
    )

    if (
      elapsed >= data.duration
    ) {
      planeData.geometry.setDrawRange(
        0,
        planeData.geometry
          .getAttribute('position')
          .count
      )

      startTimeRef.current = null
    }
  })

  if (!planeData) return null

  return (
    <mesh geometry={planeData.geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.1}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}


// ======================================================
// SCENE
// ======================================================

function Scene({
  data,
  colorMode,
  displayMode,
  controlsRef,
  playTrigger
}) {
  return (
    <>
      <color
        attach="background"
        args={['#f2f2ef']}
      />

      {data &&
        displayMode === 'path' && (
          <Trajectory
            data={data}
            colorMode={colorMode}
            playTrigger={playTrigger}
          />
        )}

      {data &&
        displayMode === 'plane' && (
          <BladePlane
            data={data}
            colorMode={colorMode}
            playTrigger={playTrigger}
          />
        )}

      <OrbitControls
        ref={controlsRef}
        target={[0, 0, 0]}
      />
    </>
  )
}


// ======================================================
// UI
// ======================================================

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}


function ResetIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M20 11a8 8 0 1 0-2.34 5.66"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <path
        d="M20 4v7h-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}


function Legend({
  data,
  colorMode
}) {
  if (!data) return null

  const maxSpeed =
    Math.max(
      ...data.samples.map(
        (sample) => sample.speed
      )
    )

  if (colorMode === 'speed') {
    return (
      <div className="legend">
        <div className="legendHeader">
          <span>Speed</span>

          <span>
            Max {maxSpeed.toFixed(1)} m/s
          </span>
        </div>

        <div className="speedGradient" />

        <div className="legendTicks">
          <span>0</span>
          <span>6</span>
          <span>12 m/s</span>
        </div>
      </div>
    )
  }

  return (
    <div className="legend">
      <div className="legendHeader">
        <span>Edge alignment error</span>
      </div>

      <div className="edgeGradient" />

      <div className="legendTicks">
        <span>0°</span>
        <span>5°</span>
        <span>10°+</span>
      </div>
    </div>
  )
}


// ======================================================
// APP
// ======================================================

function App() {
  const [data, setData] =
    useState(null)

  const [colorMode, setColorMode] =
    useState('speed')

  const [displayMode, setDisplayMode] =
    useState('path')

  const [playTrigger, setPlayTrigger] =
    useState(0)

  const controlsRef = useRef()

  // Load JSON

  useEffect(() => {
    fetch('/data/test_motion_1.json')
      .then(
        (response) =>
          response.json()
      )
      .then((json) => {
        console.log(
          'Motion data loaded:',
          json
        )

        setData(json)
      })
      .catch((error) => {
        console.error(
          'Failed to load motion data:',
          error
        )
      })
  }, [])

  function resetView() {
    if (!controlsRef.current) return

    controlsRef.current.reset()
  }

  return (
    <div className="app">
      <div className="viewer">
        <Canvas
          camera={{
            position: [2.4, 1.6, 3.2],
            fov: 40
          }}
        >
          <Scene
            data={data}
            colorMode={colorMode}
            displayMode={displayMode}
            controlsRef={controlsRef}
            playTrigger={playTrigger}
          />
        </Canvas>

        <Legend
          data={data}
          colorMode={colorMode}
        />

        <div className="controls">
          <button
            className="iconButton"
            onClick={() =>
              setPlayTrigger(
                (value) => value + 1
              )
            }
            title="Replay motion"
            aria-label="Replay motion"
          >
            <PlayIcon />
          </button>

          <button
            className={`toggle ${
              colorMode === 'edge'
                ? 'toggleRight'
                : ''
            }`}
            onClick={() =>
              setColorMode(
                (prev) =>
                  prev === 'speed'
                    ? 'edge'
                    : 'speed'
              )
            }
            aria-label="Switch between speed and edge alignment coloring"
          >
            <span>Speed</span>
            <span>Edge</span>
            <div className="toggleThumb" />
          </button>

          <button
            className={`toggle ${
              displayMode === 'plane'
                ? 'toggleRight'
                : ''
            }`}
            onClick={() =>
              setDisplayMode(
                (prev) =>
                  prev === 'path'
                    ? 'plane'
                    : 'path'
              )
            }
            aria-label="Switch between path and blade plane"
          >
            <span>Path</span>
            <span>Plane</span>
            <div className="toggleThumb" />
          </button>

          <button
            className="iconButton"
            onClick={resetView}
            title="Reset view"
            aria-label="Reset view"
          >
            <ResetIcon />
          </button>
        </div>
      </div>
    </div>
  )
}


export default App
