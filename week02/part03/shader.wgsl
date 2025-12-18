// Vertex shader output: clip-space position + RGBA color passed to fragment
struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f, // interpolated RGBA
};

@vertex
fn main_vs(
  @location(0) inPos : vec2f,    // input position (NDC)
  @location(1) inColor : vec4f   // per-vertex color (RGBA)
) -> VSOut {
  var out : VSOut;
  out.position = vec4f(inPos, 0.0, 1.0); // clip-space position
  out.color = inColor;                   // pass color through
  return out;
}

@fragment
fn main_fs(@location(0) c : vec4f) -> @location(0) vec4f {
  // Output interpolated color
  return c;
}
