/**
 * The user's photo when there is one, their initials when there is not.
 *
 * @param {object} props
 * @param {string|null} [props.src]       Object URL from useProfileImages().
 * @param {string} props.initials
 * @param {string} [props.className]     Size modifiers: avatar-sm, avatar-lg, avatar-xl.
 */
export default function UserAvatar({ src, initials, className = '' }) {
  return (
    <span className={`avatar ${className}`} aria-hidden="true">
      {src ? <img src={src} alt="" className="avatar-img" /> : initials}
    </span>
  );
}
