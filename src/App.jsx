import {
  Canvas,
  useFrame,
  useThree
} from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
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

  const widthDirection =
    new THREE.Vector3(1, 0, 0)
      .applyQuaternion(worldQuaternion)

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

  const [visibleCount, setVisibleCount] =
    useState(data.samples.length)

  const trajectoryData = useMemo(() => {
    const center = getMotionCenter(data)

    const points =
      data.samples.map(
        (sample) =>
          new THREE.Vector3(
            sample.tip[0] - center.x,
            sample.tip[1] - center.y,
            sample.tip[2] - center.z
          )
      )

    const colors =
      data.samples.map((sample) => {
        const baseColor =
          colorMode === 'speed'
            ? sample.speedColor
            : sample.edgeColor

        const planeColor =
          new THREE.Color(
            baseColor[0],
            baseColor[1],
            baseColor[2]
          )

        planeColor.offsetHSL(
          0,
          0.12,
          -0.08
        )

        const selectedColor = [
          planeColor.r,
          planeColor.g,
          planeColor.b
        ]

        return new THREE.Color(
          selectedColor[0],
          selectedColor[1],
          selectedColor[2]
        )
      })

    return {
      points,
      colors
    }
  }, [data, colorMode])

  useEffect(() => {
    setVisibleCount(data.samples.length)
  }, [data])

  useFrame(({ clock }) => {
    if (
      playTrigger !==
      lastTriggerRef.current
    ) {
      lastTriggerRef.current =
        playTrigger

      startTimeRef.current =
        clock.elapsedTime

      setVisibleCount(1)
    }

    if (
      startTimeRef.current === null
    ) {
      return
    }

    const elapsed =
      clock.elapsedTime -
      startTimeRef.current

    let nextVisibleCount = 1

    for (
      let i = 0;
      i < data.samples.length;
      i++
    ) {
      if (
        data.samples[i].t <= elapsed
      ) {
        nextVisibleCount = i + 1
      } else {
        break
      }
    }

    setVisibleCount(
      (current) =>
        current === nextVisibleCount
          ? current
          : nextVisibleCount
    )

    if (
      elapsed >= data.duration
    ) {
      setVisibleCount(
        data.samples.length
      )

      startTimeRef.current = null
    }
  })

  const points =
    trajectoryData.points.slice(
      0,
      visibleCount
    )

  const colors =
    trajectoryData.colors.slice(
      0,
      visibleCount
    )

  if (points.length < 2) return null

  return (
    <Line
      points={points}
      vertexColors={colors}
      lineWidth={2.8}
    />
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
    const center =
      getMotionCenter(data)

    const bladeWidth =
      data.sword?.bladeWidth ?? 0.05

    const halfWidth =
      bladeWidth / 2

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

  return (
    <mesh geometry={planeData.geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.32}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

function ScaleTracker({ onScaleChange }) {
  const { camera, size } = useThree()

  const previousLabel = useRef(null)
  const previousWidth = useRef(null)

  useFrame(() => {
    if (!camera || !size.height) return

    const target =
      new THREE.Vector3(0, 0, 0)

    const distance =
      camera.position.distanceTo(target)

    const fovRadians =
      THREE.MathUtils.degToRad(
        camera.fov
      )

    const visibleHeight =
      2 *
      distance *
      Math.tan(fovRadians / 2)

    const metersPerPixel =
      visibleHeight / size.height


    // Aim for roughly 90 px long

    const targetMeters =
      metersPerPixel * 90


    const niceValues = [
      0.05,
      0.1,
      0.2,
      0.5,
      1,
      2,
      5,
      10
    ]


    let chosen =
      niceValues[
      niceValues.length - 1
      ]


    for (const value of niceValues) {
      if (value >= targetMeters) {
        chosen = value
        break
      }
    }


    const width =
      chosen / metersPerPixel


    const label =
      chosen < 1
        ? `${Math.round(
          chosen * 100
        )} cm`
        : `${chosen} m`


    if (
      label !== previousLabel.current ||
      Math.abs(
        width -
        (previousWidth.current ?? 0)
      ) > 1
    ) {
      previousLabel.current = label
      previousWidth.current = width

      onScaleChange({
        label,
        width
      })
    }
  })

  return null
}

// ======================================================
// SCENE
// ======================================================

function Scene({
  data,
  colorMode,
  displayMode,
  controlsRef,
  playTrigger,
  interactionEnabled,
  onScaleChange
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
        enabled={interactionEnabled}
      />

      <ScaleTracker
        onScaleChange={onScaleChange}
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

  const [
    interactionEnabled,
    setInteractionEnabled
  ] = useState(false)

  const [scaleInfo, setScaleInfo] =
    useState({
      label: '1 m',
      width: 90
    })

  const controlsRef = useRef()

  useEffect(() => {
    fetch('/data/test_motion_1.json')
      .then(
        (response) =>
          response.json()
      )
      .then((json) => {
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
            interactionEnabled={
              interactionEnabled
            }
            onScaleChange={setScaleInfo}
          />
        </Canvas>

        {!interactionEnabled && (
          <button
            className="interactionGate"
            onClick={() =>
              setInteractionEnabled(true)
            }
            aria-label="Enable 3D interaction"
          >
            <span>
              Click to interact
            </span>
          </button>
        )}

        <Legend
          data={data}
          colorMode={colorMode}
        />

        <div className="scaleBar">

          <span className="scaleLabel">
            {scaleInfo.label}
          </span>

          <div
            className="scaleLine"
            style={{
              width: `${scaleInfo.width}px`
            }}
          >
            <span />
            <span />
          </div>

        </div>

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
            className={`toggle ${colorMode === 'edge'
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
            className={`toggle ${displayMode === 'plane'
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
