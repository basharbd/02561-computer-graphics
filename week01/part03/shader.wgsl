// Vertex shader output: clip-space position + RGB color passed to fragment
struct VSOut {
  @builtin(position) position : vec4f, // clip-space position (x,y,z,w)
  @location(0) color : vec3f,          // interpolated RGB color
};

@vertex
fn main_vs(
  @location(0) inPos : vec2f,    // 2D vertex position in clip space (-1..1)
  @location(1) inColor : vec3f   // per-vertex RGB color (0..1)
) -> VSOut {
  var out : VSOut;
  out.position = vec4f(inPos, 0.0, 1.0); // make it 4D; z=0 (on screen plane), w=1
  out.color = inColor;                  // pass color to be interpolated across the primitive
  return out;
}

@fragment
fn main_fs(@location(0) color : vec3f) -> @location(0) vec4f {
  return vec4f(color, 1.0); // output final RGBA (opaque)
}
