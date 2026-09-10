"""Génération de la clé FEN tronquée et extraction des demi-coups d'une partie.

On ne réimplémente rien : python-chess fait le parsing PGN, la génération FEN,
la validation des coups. Le seul point subtil est la canonicalisation de la
prise en passant (voir truncate_fen).
"""
import io
import chess
import chess.pgn

MAX_PLIES = 30  # on ne conserve que les 30 premiers demi-coups


class SkipGame(Exception):
    """Partie à ignorer (variante, partie non terminée, illisible)."""


def truncate_fen(board: chess.Board) -> str:
    """Clé de position : les 4 champs FEN (placement, trait, roques, e.p.),
    sans compteur de demi-coups ni numéro de coup.

    Piège e.p. : le FEN standard écrit la case en passant dès qu'un pion a fait
    un double-pas, même si aucune capture n'est légale. Deux parties atteignant
    la même position (l'une via un double-pas anodin) auraient alors des clés
    différentes → transposition perdue. `en_passant="legal"` n'émet la case que
    si une capture e.p. est réellement possible. epd() omet déjà les compteurs.
    """
    return board.epd(en_passant="legal")


def _eval_cp(node) -> int | None:
    """Éval en centipions du point de vue des Blancs, si présente (Lichess evals=true).
    Défensif : None sur mat ou comment absent/illisible."""
    try:
        ev = node.eval()
        if ev is None:
            return None
        return ev.white().score()  # None si score de mat
    except Exception:
        return None


def _clock_ms(node) -> int | None:
    try:
        c = node.clock()
        return int(c * 1000) if c is not None else None
    except Exception:
        return None


def parse_game(pgn_text: str, my_color: str):
    """Parse un PGN et renvoie (result, termination, eco, opening_name, plies).

    result est exprimé de MON point de vue à partir de l'en-tête Result et de
    my_color. plies est une liste de dicts prêts pour game_plies.
    Lève SkipGame si la partie est une variante, non terminée, ou illisible.
    """
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise SkipGame("PGN illisible")

    h = game.headers
    if h.get("Variant", "Standard") not in ("Standard", "From Position", "?"):
        raise SkipGame(f"variante non standard: {h.get('Variant')}")

    result = _result_from_my_pov(h.get("Result", "*"), my_color)
    if result is None:
        raise SkipGame(f"partie non terminée: {h.get('Result')}")

    board = game.board()
    plies = []
    ply = 0
    for node in game.mainline():
        if ply >= MAX_PLIES:
            break
        move = node.move
        from_fen = truncate_fen(board)
        san = board.san(move)
        # is_my_move : c'est mon coup si le trait (avant de jouer) est ma couleur.
        # Robuste même pour une partie démarrant d'une position posée.
        is_mine = board.turn == (chess.WHITE if my_color == "white" else chess.BLACK)
        board.push(move)
        plies.append({
            "ply": ply,
            "from_fen": from_fen,
            "san": san,
            "uci": move.uci(),
            "to_fen": truncate_fen(board),
            "is_my_move": is_mine,
            "eval_cp": _eval_cp(node),
            "clock_ms": _clock_ms(node),
        })
        ply += 1

    return result, h.get("Termination"), h.get("ECO"), h.get("Opening"), plies


def _result_from_my_pov(pgn_result: str, my_color: str):
    """'1-0'/'0-1'/'1/2-1/2'/'*' + ma couleur -> 'win'/'draw'/'loss'/None."""
    if pgn_result == "1/2-1/2":
        return "draw"
    if pgn_result == "1-0":
        return "win" if my_color == "white" else "loss"
    if pgn_result == "0-1":
        return "win" if my_color == "black" else "loss"
    return None  # '*' : partie abandonnée/en cours
