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

function getSwordQuaternion(sample) {
  // JSON stores quaternion as:
  // [w, x, y, z]
  //
  // Three.js expects:
  // (x, y, z, w)

  const sensorQuaternion =
    new THREE.Quaternion(
      sample.q[1],
      sample.q[2],
      sample.q[3],
      sample.q[0]
    ).normalize()

  // Exact same correction as TD:
  //
  // Geometry COMP
  // Pre-Xform:
  // Rotate X = 90
  // Rotate Y = 180
  // Rotate Z = 0

  const preRotation =
    new THREE.Quaternion()
      .setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(90),
          THREE.MathUtils.degToRad(180),
          THREE.MathUtils.degToRad(0),
          'XYZ'
        )
      )

  // TD transform chain:
  //
  // local point
  // -> BNO rotation
  // -> Pre-Xform
  //
  // therefore:
  // worldQ = preQ * sensorQ

  return new THREE.Quaternion()
    .multiplyQuaternions(
      preRotation,
      sensorQuaternion
    )
    .normalize()
}


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

  // TEST AXIS:
  // X = (1, 0, 0)
  const localBladeAxis =
    new THREE.Vector3(1, 0, 0)

  return localBladeAxis
    .applyQuaternion(worldQuaternion)
    .normalize()
}


function getBladeNormalDirection(sample) {
  const swordQuaternion =
    getSwordQuaternion(sample)

  // Local Z = blade normal

  return new THREE.Vector3(
    0,
    0,
    1
  )
    .applyQuaternion(
      swordQuaternion
    )
    .normalize()
}


// ======================================================
// PATH
// ======================================================

function Trajectory({
  data,
  colorMode,
  playbackTime
}) {
  const trajectoryData = useMemo(() => {
    const center = getMotionCenter(data)

    const points = data.samples.map(
      (sample) =>
        new THREE.Vector3(
          sample.tip[0] - center.x,
          sample.tip[1] - center.y,
          sample.tip[2] - center.z
        )
    )

    const colors = data.samples.map(
      (sample) => {
        const baseColor =
          colorMode === 'speed'
            ? sample.speedColor
            : sample.edgeColor

        return new THREE.Color(
          baseColor[0],
          baseColor[1],
          baseColor[2]
        )
      }
    )

    return {
      points,
      colors
    }
  }, [data, colorMode])

  let visibleCount = 1

  for (
    let i = 0;
    i < data.samples.length;
    i++
  ) {
    if (
      data.samples[i].t <= playbackTime
    ) {
      visibleCount = i + 1
    } else {
      break
    }
  }

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
      lineWidth={3.2}
    />
  )
}

// ======================================================
// RIGHT HAND PATH
// ======================================================

function HandTrajectory({
  data,
  playbackTime,
  accessor,
  color,
  opacity = 0.4,
  lineWidth = 1.5
}) {
  const points = useMemo(() => {
    const center = getMotionCenter(data)

    return data.samples
      .map((sample) => {
        const p = sample[accessor]

        if (
          !p ||
          !Array.isArray(p) ||
          p.length < 3
        ) {
          return null
        }

        return {
          t: sample.t,
          point: new THREE.Vector3(
            p[0] - center.x,
            p[1] - center.y,
            p[2] - center.z
          )
        }
      })
      .filter(Boolean)
  }, [data, accessor])

  const visiblePoints = points
    .filter((item) => item.t <= playbackTime)
    .map((item) => item.point)

  if (visiblePoints.length < 2) {
    return null
  }

  return (
    <Line
      points={visiblePoints}
      color={color}
      lineWidth={lineWidth}
      transparent
      opacity={opacity}
    />
  )
}

// ======================================================
// SWEPT BLADE PLANE
// ======================================================

function BladePlane({
  data,
  colorMode,
  playbackTime
}) {
  const planeData = useMemo(() => {
    const center = getMotionCenter(data)

    const poses = data.samples.map(
      (sample) => {
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

        return {
          root,
          tip
        }
      }
    )

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
      const current = poses[i]
      const next = poses[i + 1]

      const sample =
        data.samples[i]

      const selectedColor =
        colorMode === 'speed'
          ? sample.speedColor
          : sample.edgeColor

      // Swept surface of the actual measured
      // blade longitudinal segment.
      //
      // current root ---- current tip
      //      |                 |
      // next root ------- next tip

      addQuad(
        current.root,
        current.tip,
        next.tip,
        next.root,
        selectedColor
      )
    }

    const geometry =
      new THREE.BufferGeometry()

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        positions,
        3
      )
    )

    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        colors,
        3
      )
    )

    geometry.computeVertexNormals()

    return {
      geometry,
      verticesPerInterval: 6
    }
  }, [data, colorMode])

  useEffect(() => {
    let visibleIntervals = 0

    for (
      let i = 1;
      i < data.samples.length;
      i++
    ) {
      if (
        data.samples[i].t <=
        playbackTime
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
  }, [
    playbackTime,
    data,
    planeData
  ])

  return (
    <mesh geometry={planeData.geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.24}
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
  playbackTime,
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
            playbackTime={
              playbackTime
            }
          />
        )}

      {data &&
        displayMode === 'plane' && (
          <BladePlane
            data={data}
            colorMode={colorMode}
            playbackTime={
              playbackTime
            }
          />
        )}

      {data && (
        <>
          <HandTrajectory
            data={data}
            playbackTime={playbackTime}
            accessor="root"
            color="#6f747a"
            opacity={0.5}
            lineWidth={1.6}
          />

          <HandTrajectory
            data={data}
            playbackTime={playbackTime}
            accessor="handL"
            color="#9a9187"
            opacity={0.32}
            lineWidth={1.3}
          />
        </>
      )}

      <OrbitControls
        ref={controlsRef}
        target={[0, 0, 0]}
      />

      <ScaleTracker
        onScaleChange={onScaleChange}
      />
      <gridHelper
        args={[
          3.2,
          4,
          '#cdcdc7', // center line: slightly darker
          '#d9d9d2'  // grid lines: just a bit darker
        ]}
        position={[0, -1.15, 0]}
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
        <div className="legendHandPaths">
          <div className="legendHandRow">
            <span
              className="legendHandSwatch"
              style={{
                background: '#6f747a',
                opacity: 0.5
              }}
            />
            <span>Right hand</span>
          </div>

          <div className="legendHandRow">
            <span
              className="legendHandSwatch"
              style={{
                background: '#9a9187',
                opacity: 0.32
              }}
            />
            <span>Left hand</span>
          </div>
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
        <span>10°</span>
        <span>20°+</span>
      </div>
      <div className="legendHandPaths">
        <div className="legendHandRow">
          <span
            className="legendHandSwatch"
            style={{
              background: '#6f747a',
              opacity: 0.5
            }}
          />
          <span>Right hand</span>
        </div>

        <div className="legendHandRow">
          <span
            className="legendHandSwatch"
            style={{
              background: '#9a9187',
              opacity: 0.32
            }}
          />
          <span>Left hand</span>
        </div>
      </div>
    </div>
  )
}

function StaticTrajectoryCover({
  data,
  onActivate
}) {
  const softenColor = (
    rgb,
    amount = 0.18
  ) => {
    const background = [
      0.949,
      0.949,
      0.937
    ]

    return rgb.map(
      (value, i) =>
        value * (1 - amount) +
        background[i] * amount
    )
  }
  const preview = useMemo(() => {
    if (!data?.samples?.length) {
      return null
    }

    const width = 1000
    const height = 667

    const center =
      getMotionCenter(data)

    // Match the 3D viewer's default camera
    const camera =
      new THREE.PerspectiveCamera(
        40,
        width / height,
        0.01,
        100
      )

    camera.position.set(
      2.4,
      1.6,
      3.2
    )

    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()

    const projectPoint = (coords) => {
      if (
        !coords ||
        !Array.isArray(coords) ||
        coords.length < 3
      ) {
        return null
      }

      const point =
        new THREE.Vector3(
          coords[0] - center.x,
          coords[1] - center.y,
          coords[2] - center.z
        )

      point.project(camera)

      return {
        x:
          (point.x * 0.5 + 0.5) *
          width,

        y:
          (-point.y * 0.5 + 0.5) *
          height
      }
    }

    const projected =
      data.samples.map((sample) => {
        const tip =
          projectPoint(sample.tip)

        const rightHand =
          projectPoint(sample.root)

        const leftHand =
          projectPoint(sample.handL)

        return {
          tip,
          rightHand,
          leftHand,
          color:
            sample.speedColor
        }
      })

    return {
      width,
      height,
      projected
    }
  }, [data])

  if (!preview) {
    return null
  }

  return (
    <button
      className="staticCover"
      onClick={onActivate}
      aria-label="Open interactive 3D motion viewer"
    >
      <svg
        viewBox={`0 0 ${preview.width} ${preview.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {preview.projected
            .slice(0, -1)
            .map((point, i) => {
              const next =
                preview.projected[i + 1]

              if (
                !point.tip ||
                !next.tip
              ) {
                return null
              }

              const [r1, g1, b1] =
                softenColor(point.color, 0.3)

              const [r2, g2, b2] =
                softenColor(next.color, 0.3)

              const color1 =
                `rgb(${Math.round(r1 * 255)},` +
                `${Math.round(g1 * 255)},` +
                `${Math.round(b1 * 255)})`

              const color2 =
                `rgb(${Math.round(r2 * 255)},` +
                `${Math.round(g2 * 255)},` +
                `${Math.round(b2 * 255)})`

              return (
                <linearGradient
                  key={`gradient-${i}`}
                  id={`tip-gradient-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={point.tip.x}
                  y1={point.tip.y}
                  x2={next.tip.x}
                  y2={next.tip.y}
                >
                  <stop
                    offset="0%"
                    stopColor={color1}
                  />

                  <stop
                    offset="100%"
                    stopColor={color2}
                  />
                </linearGradient>
              )
            })}
        </defs>
        {/* LEFT HAND */}
        {preview.projected
          .slice(0, -1)
          .map((point, i) => {
            const next =
              preview.projected[i + 1]

            if (
              !point.leftHand ||
              !next.leftHand
            ) {
              return null
            }

            return (
              <line
                key={`left-${i}`}
                x1={point.leftHand.x}
                y1={point.leftHand.y}
                x2={next.leftHand.x}
                y2={next.leftHand.y}
                stroke="#9a9187"
                strokeOpacity={0.25}
                strokeWidth={1.8}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

        {/* RIGHT HAND */}
        {preview.projected
          .slice(0, -1)
          .map((point, i) => {
            const next =
              preview.projected[i + 1]

            if (
              !point.rightHand ||
              !next.rightHand
            ) {
              return null
            }

            return (
              <line
                key={`right-${i}`}
                x1={point.rightHand.x}
                y1={point.rightHand.y}
                x2={next.rightHand.x}
                y2={next.rightHand.y}
                stroke="#6f747a"
                strokeOpacity={0.4}
                strokeWidth={2.1}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

        {/* SWORD TIP */}
        {preview.projected
          .slice(0, -1)
          .map((point, i) => {
            const next =
              preview.projected[i + 1]

            if (
              !point.tip ||
              !next.tip
            ) {
              return null
            }

            return (
              <line
                key={`tip-${i}`}
                x1={point.tip.x}
                y1={point.tip.y}
                x2={next.tip.x}
                y2={next.tip.y}
                stroke={`url(#tip-gradient-${i})`}
                strokeWidth={5.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
      </svg>

      <span className="staticCoverHint">
        Explore 3D
      </span>
    </button>
  )
}

// ======================================================
// MOTION / VIDEO CONFIG
// ======================================================

const MOTION_CONFIGS = {
  right_fendente: {
    data: '/data/test_motion_01.json',
    video: '/data/01_right_fendente.MP4',
    videoOffset: 0.7
  },

  left_midcut_thrust: {
    data: '/data/test_motion_02.json',
    video: '/data/02_left_midcut_thrust.MP4',
    videoOffset: 1.0
  },

  parry_two_zwerch: {
    data: '/data/test_motion_03.json',
    video: '/data/03_parry_zwerch.MP4',
    videoOffset: 1.4
  },

  scheitelhau_thrust: {
    data: '/data/test_motion_04.json',
    video: '/data/04_scheitelhau_thrust.MP4',
    videoOffset: 1.4
  },

  left_fendente: {
    data: '/data/test_motion_05.json',
    video: '/data/05_left_fendente.MP4',
    videoOffset: 0.7
  }
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

  const [
    playbackTime,
    setPlaybackTime
  ] = useState(0)

  const [
    isPlaying,
    setIsPlaying
  ] = useState(false)

  const playbackTimeRef =
    useRef(0)

  const videoRef =
    useRef(null)

  const [
    viewerActivated,
    setViewerActivated
  ] = useState(false)

  const viewerIdRef = useRef(
    `viewer-${Math.random()
      .toString(36)
      .slice(2)}`
  )

  const channelRef =
    useRef(null)

  const [
    scaleInfo,
    setScaleInfo
  ] = useState({
    label: '1 m',
    width: 90
  })

  const controlsRef =
    useRef()

  // ------------------------------------------------------
  // Choose motion from URL
  // ------------------------------------------------------

  const params =
    new URLSearchParams(
      window.location.search
    )

  const motionKey =
    params.get('motion') ||
    'right_fendente'

  const motionConfig =
    MOTION_CONFIGS[motionKey] ||
    MOTION_CONFIGS.right_fendente

  const videoOffset =
    motionConfig.videoOffset || 0

  // ------------------------------------------------------
  // Only one active WebGL viewer at a time
  // ------------------------------------------------------

  useEffect(() => {
    const channel =
      new BroadcastChannel(
        'cyber-sword-viewer-active'
      )

    channelRef.current = channel

    channel.onmessage =
      (event) => {
        const {
          type,
          viewerId
        } = event.data || {}

        if (
          type ===
          'ACTIVATE_VIEWER' &&
          viewerId !==
          viewerIdRef.current
        ) {
          setIsPlaying(false)

          if (videoRef.current) {
            videoRef.current.pause()
          }

          setViewerActivated(false)
        }
      }

    return () => {
      channel.close()
    }
  }, [])

  // ------------------------------------------------------
  // Load JSON
  // ------------------------------------------------------

  useEffect(() => {
    fetch(motionConfig.data)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          )
        }

        return response.json()
      })

      .then((json) => {
        console.log(
          'Loaded motion:',
          motionKey,
          json
        )

        setData(json)

        // Keep your existing behavior:
        // show the complete trajectory initially.
        playbackTimeRef.current =
          json.duration

        setPlaybackTime(
          json.duration
        )
      })

      .catch((error) => {
        console.error(
          'Failed to load motion data:',
          error
        )
      })
  }, [
    motionConfig.data,
    motionKey
  ])

  // ------------------------------------------------------
  // Video becomes master playback clock
  // ------------------------------------------------------

  useEffect(() => {
    if (
      !isPlaying ||
      !data ||
      !videoRef.current
    ) {
      return
    }

    let animationFrame

    const video =
      videoRef.current

    function syncFromVideo() {
      const motionTime =
        video.currentTime -
        videoOffset

      const clampedTime =
        Math.max(
          0,
          Math.min(
            motionTime,
            data.duration
          )
        )

      playbackTimeRef.current =
        clampedTime

      setPlaybackTime(
        clampedTime
      )

      if (
        clampedTime >=
        data.duration ||
        video.ended
      ) {
        video.pause()

        setIsPlaying(false)

        return
      }

      animationFrame =
        requestAnimationFrame(
          syncFromVideo
        )
    }

    animationFrame =
      requestAnimationFrame(
        syncFromVideo
      )

    return () => {
      cancelAnimationFrame(
        animationFrame
      )
    }
  }, [
    isPlaying,
    data,
    videoOffset
  ])

  // ------------------------------------------------------
  // Camera reset
  // ------------------------------------------------------

  function resetView() {
    if (!controlsRef.current) {
      return
    }

    controlsRef.current.reset()
  }

  // ------------------------------------------------------
  // Shared seek
  // ------------------------------------------------------

  function seekMotion(value) {
    if (!data) return

    const clamped =
      Math.max(
        0,
        Math.min(
          value,
          data.duration
        )
      )

    setIsPlaying(false)

    playbackTimeRef.current =
      clamped

    setPlaybackTime(
      clamped
    )

    if (videoRef.current) {
      videoRef.current.pause()

      videoRef.current.currentTime =
        clamped +
        videoOffset

      console.log(
        'motion:',
        clamped,
        'video:',
        videoRef.current.currentTime
      )
    }
  }

  // ------------------------------------------------------
  // Play synchronized motion + video
  // ------------------------------------------------------

  function playMotion() {
    if (
      !data ||
      !videoRef.current
    ) {
      return
    }

    const video =
      videoRef.current

    let startTime =
      playbackTimeRef.current

    // Replay from start if we're already at the end
    if (
      startTime >=
      data.duration - 0.001
    ) {
      startTime = 0

      playbackTimeRef.current =
        0

      setPlaybackTime(0)
    }

    video.currentTime =
      startTime +
      videoOffset

    video
      .play()
      .then(() => {
        setIsPlaying(true)
      })
      .catch((error) => {
        console.error(
          'Video playback failed:',
          error
        )
      })
  }

  // ------------------------------------------------------
  // Activate viewer
  // ------------------------------------------------------

  function activateViewer() {
    setViewerActivated(true)

    channelRef.current
      ?.postMessage({
        type:
          'ACTIVATE_VIEWER',

        viewerId:
          viewerIdRef.current
      })

    // Put video at matching frame
    requestAnimationFrame(() => {
      if (videoRef.current) {
        videoRef.current.currentTime =
          playbackTimeRef.current +
          videoOffset
      }
    })
  }

  return (
    <div className="app">

      <div className="motionExperience">

        {/* ============================================= */}
        {/* 3D / STATIC TRAJECTORY PANE */}
        {/* ============================================= */}

        <div className="viewerPane">

          <div className="viewer">

            {viewerActivated ? (

              <Canvas
                camera={{
                  position: [
                    2.4,
                    1.6,
                    3.2
                  ],

                  fov: 40
                }}
              >
                <Scene
                  data={data}
                  colorMode={
                    colorMode
                  }
                  displayMode={
                    displayMode
                  }
                  controlsRef={
                    controlsRef
                  }
                  playbackTime={
                    playbackTime
                  }
                  onScaleChange={
                    setScaleInfo
                  }
                />
              </Canvas>

            ) : (

              <StaticTrajectoryCover
                data={data}
                onActivate={
                  activateViewer
                }
              />

            )}

            <Legend
              data={data}
              colorMode={
                colorMode
              }
            />

            <div className="scaleBar">

              <span
                className="scaleLabel"
              >
                {scaleInfo.label}
              </span>

              <div
                className="scaleLine"
                style={{
                  width:
                    `${scaleInfo.width}px`
                }}
              >
                <span />
                <span />
              </div>

            </div>

            {data &&
              viewerActivated && (

                <div
                  className=
                  "playbackSlider"
                >
                  <input
                    type="range"
                    min="0"
                    max={
                      data.duration
                    }
                    step="0.001"
                    value={
                      playbackTime
                    }

                    onChange={
                      (event) =>
                        seekMotion(
                          Number(
                            event
                              .target
                              .value
                          )
                        )
                    }

                    aria-label=
                    "Motion playback position"
                  />
                </div>

              )}

            {viewerActivated && (

              <div
                className="controls"
              >

                <button
                  className=
                  "iconButton"
                  onClick={
                    playMotion
                  }
                  title=
                  "Replay motion"
                  aria-label=
                  "Replay motion"
                >
                  <PlayIcon />
                </button>

                <button
                  className={`toggle ${colorMode ===
                    'edge'
                    ? 'toggleRight'
                    : ''
                    }`}

                  onClick={() =>
                    setColorMode(
                      (prev) =>
                        prev ===
                          'speed'
                          ? 'edge'
                          : 'speed'
                    )
                  }

                  aria-label=
                  "Switch between speed and edge alignment coloring"
                >
                  <span>
                    Speed
                  </span>

                  <span>
                    Edge
                  </span>

                  <div
                    className=
                    "toggleThumb"
                  />
                </button>

                <button
                  className={`toggle ${displayMode ===
                    'plane'
                    ? 'toggleRight'
                    : ''
                    }`}

                  onClick={() =>
                    setDisplayMode(
                      (prev) =>
                        prev ===
                          'path'
                          ? 'plane'
                          : 'path'
                    )
                  }

                  aria-label=
                  "Switch between path and blade plane"
                >
                  <span>
                    Path
                  </span>

                  <span>
                    Plane
                  </span>

                  <div
                    className=
                    "toggleThumb"
                  />
                </button>

                <button
                  className=
                  "iconButton"
                  onClick={
                    resetView
                  }
                  title=
                  "Reset view"
                  aria-label=
                  "Reset view"
                >
                  <ResetIcon />
                </button>

              </div>

            )}

          </div>

        </div>

        {/* ============================================= */}
        {/* VIDEO PANE */}
        {/* ============================================= */}

        <div
          className={`videoPane ${viewerActivated
            ? 'videoPaneActive'
            : 'videoPaneStatic'
            }`}
        >
          <video
            ref={videoRef}

            src={
              motionConfig.video
            }

            className=
            "motionVideo"

            muted
            playsInline
            preload="metadata"

            onLoadedMetadata={() => {
              if (!videoRef.current) {
                return
              }

              console.log(
                'VIDEO DURATION:',
                videoRef.current.duration
              )

              console.log(
                'DATA DURATION:',
                data?.duration
              )

              const requested =
                playbackTimeRef.current +
                videoOffset

              const safeTime =
                Math.min(
                  requested,
                  Math.max(
                    0,
                    videoRef.current.duration - 0.01
                  )
                )

              videoRef.current.currentTime =
                safeTime
            }}
          />
        </div>

      </div>

    </div>
  )
}

export default App
